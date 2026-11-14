import { retrievePricingFromText } from 'pricing4ts/server';
import { formatCreatedAt } from './created-at';
import {
  dumpPricingDoc,
  LATEST_SYNTAX_VERSION,
  loadPricingDoc,
  PricingDoc,
  PricingYamlError,
  STORED_PRICING_MAX_BYTES,
  upgradeToLatestSyntax,
} from './pricing-syntax';

export interface TopLevelFields {
  saasName?: string;
  version?: string;
  createdAt?: Date;
}

/** What the parser makes of a pricing text. */
export type ParsedPricing = ReturnType<typeof retrievePricingFromText>;

export interface StampResult {
  text: string;
  /** True when the text had to be written again from its document (comments and layout lost). */
  regenerated: boolean;
  /** The parser's result for `text`. */
  pricing: ParsedPricing;
}

/** The order the fields are stamped in, which is also where missing ones are inserted. */
const FIELD_ORDER = ['saasName', 'version', 'createdAt'] as const;
type Field = (typeof FIELD_ORDER)[number];

function topLevelLine(key: Field): RegExp {
  return new RegExp(`^${key}[ \\t]*:[^\\r\\n]*`, 'm');
}

/** The values as the stamped text must load them, in stamping order. */
function expectedValues(fields: TopLevelFields): Array<[Field, string]> {
  const values: Array<[Field, string]> = [];
  for (const key of FIELD_ORDER) {
    const value = fields[key];
    if (value === undefined) continue;
    values.push([key, value instanceof Date ? formatCreatedAt(value) : String(value)]);
  }
  return values;
}

/**
 * Replaces each field's first top-level line (column 0), or inserts it with the
 * file's own line break: `saasName` as the first line, the others after the
 * line of the nearest field before them that the text has.
 */
function stampLines(text: string, values: Array<[Field, string]>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let stamped = text;
  for (const [key, value] of values) {
    const line = `${key}: ${JSON.stringify(value)}`;
    const existing = topLevelLine(key);
    if (existing.test(stamped)) {
      stamped = stamped.replace(existing, () => line);
      continue;
    }
    const anchor = FIELD_ORDER.slice(0, FIELD_ORDER.indexOf(key))
      .reverse()
      .map((previous) => topLevelLine(previous).exec(stamped))
      .find((match) => match !== null);
    if (!anchor) {
      stamped = `${line}${eol}${stamped}`;
      continue;
    }
    const end = anchor.index + anchor[0].length;
    stamped = `${stamped.slice(0, end)}${eol}${line}${stamped.slice(end)}`;
  }
  return stamped;
}

function isMapping(value: unknown): value is PricingDoc {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** Strict equality of loaded YAML values: dates by instant, `NaN` equal to itself. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (!isMapping(a) || !isMapping(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key]))
  );
}

/**
 * The parser refused a stamped text: `text` is that text, the caller's stamped
 * line by line when `regenerated` is false. Parsing is what a pricing costs
 * most, so nothing parses the caller's own text again for this message:
 * stamping only changes the stamped fields, and the parser's only check on them
 * is that the name is valid, so the message is the one the caller's text would
 * give unless its own `saasName` was all that was wrong.
 */
export class StampRefusedError extends PricingYamlError {
  constructor(
    message: string,
    readonly text: string,
    readonly regenerated: boolean
  ) {
    super(400, 'INVALID_PRICING', message);
    this.name = 'StampRefusedError';
  }
}

/** The parser's result for the text, or a `StampRefusedError`. */
function parse(text: string, regenerated: boolean): ParsedPricing {
  try {
    return retrievePricingFromText(text);
  } catch (error) {
    throw new StampRefusedError((error as Error)?.message ?? String(error), text, regenerated);
  }
}

/**
 * The stamped text is kept only if it loads to the original document with just
 * the stamped fields changed to the requested values: returns the parser's
 * result for it (throwing a `StampRefusedError` if the parser refuses it), or
 * undefined to regenerate. A text the parser refuses is not regenerated: the
 * regenerated text would load to the same document, so the parser would refuse
 * it too.
 */
function stampIsExact(original: PricingDoc, stampedText: string, values: Array<[Field, string]>): ParsedPricing | undefined {
  let stamped: PricingDoc;
  try {
    stamped = loadPricingDoc(stampedText, STORED_PRICING_MAX_BYTES);
  } catch {
    return undefined;
  }
  const stampedKeys = new Set<string>(values.map(([key]) => key));
  const rest = (doc: PricingDoc) => Object.keys(doc).filter((key) => !stampedKeys.has(key));
  const originalRest = rest(original);
  const stampedRest = rest(stamped);
  if (originalRest.length !== stampedRest.length) return undefined;
  if (!originalRest.every((key) => Object.prototype.hasOwnProperty.call(stamped, key) && sameValue(original[key], stamped[key]))) {
    return undefined;
  }
  if (!values.every(([key, value]) => stamped[key] === value)) return undefined;
  return parse(stampedText, false);
}

/** The document in the latest syntax with the fields set, written again from scratch. */
function regenerate(original: PricingDoc, values: Array<[Field, string]>): StampResult {
  const { doc } = upgradeToLatestSyntax(original);
  const missing: PricingDoc = {};
  for (const [key, value] of values) if (!(key in doc)) missing[key] = value;
  const result: PricingDoc = { ...missing, ...doc };
  for (const [key, value] of values) result[key] = value;
  const text = dumpPricingDoc(result);
  return { text, regenerated: true, pricing: parse(text, true) };
}

/** What the caller already has for the text, so stamping does not compute it again. */
export interface StampInputs {
  /** The document `loadPricingDoc` gives for the text. */
  loaded?: PricingDoc;
}

/**
 * Sets the top-level `saasName`, `version` and `createdAt` of a pricing YAML
 * changing only their lines, so comments and layout survive, and inserting the
 * ones that are missing. A text that is not in the latest syntax, or whose
 * stamped lines do not load back to exactly the requested change (a multi-line
 * `saasName: >`, a flow mapping, a quoted key...), is regenerated instead:
 * pricing4ts rewrites any file it reads in an older syntax, so only a text in
 * the latest one can be published as written. Only the stamped text is parsed:
 * the result carries the parser's result for it, so the caller need not parse
 * it again, and a text the parser refuses throws a `StampRefusedError`.
 */
export function stampTopLevel(text: string, fields: TopLevelFields, inputs: StampInputs = {}): StampResult {
  const original = inputs.loaded ?? loadPricingDoc(text, STORED_PRICING_MAX_BYTES);
  const values = expectedValues(fields);
  if (original.syntaxVersion === LATEST_SYNTAX_VERSION) {
    const stamped = stampLines(text, values);
    const pricing = stampIsExact(original, stamped, values);
    if (pricing) return { text: stamped, regenerated: false, pricing };
  }
  return regenerate(original, values);
}
