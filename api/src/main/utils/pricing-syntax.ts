import { createRequire } from 'module';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Safe loading of pricing YAML that comes from users (pull request proposals,
 * hand-edited merge results) or from disk, and its normalization to the latest
 * Pricing2Yaml syntax.
 *
 * `js-yaml` expands aliases and merge keys (`<<`) while it loads with its
 * default schema, so a few hundred kilobytes can take the heap down before any
 * check runs. The text is therefore loaded first with the core schema, where
 * aliases stay shared references and `<<` is an ordinary key, and its size is
 * measured by walking it, counting every visit of a shared node and the
 * characters of every key and string it reaches, so a long string used through
 * many aliases costs its length each time (`structuredClone` and
 * `yaml.dump({ noRefs })` copy it once per use). Only a text within that budget
 * is loaded again with the default schema, the one the pricing parser uses
 * (`pricing4ts/dist/server/utils/yaml-utils.js`).
 */

export type PricingDoc = Record<string, unknown>;

export type PricingYamlErrorCode =
  | 'PRICING_TOO_LARGE'
  | 'PRICING_TOO_COMPLEX'
  | 'INVALID_PRICING'
  | 'PRICING_SYNTAX_UNSUPPORTED';

export class PricingYamlError extends Error {
  constructor(
    readonly status: number,
    readonly code: PricingYamlErrorCode,
    message: string,
    readonly line?: number
  ) {
    super(message);
    this.name = 'PricingYamlError';
  }
}

/** Pricing files SPHERE reads from disk (bases and latest versions). */
export const STORED_PRICING_MAX_BYTES = 5 * 1024 * 1024;
/**
 * What `PRICING_PR_MAX_YAML_BYTES` may raise a user's text to: a JSON body takes
 * at most 2 MB and escaping can almost double a text.
 */
export const PROPOSAL_MAX_BYTES_CEILING = 1024 * 1024;
/**
 * The default limit of a user's text: over ten times the largest pricing SPHERE
 * ships (36 KB), while the parser, which grows faster than the text, takes about
 * 1.2 s of the event loop on a pricing this large (7.6 s on 1 MiB). A text is
 * parsed once, as stamped with the pricing's name, whatever name it carries, so
 * a request that sends one takes about 1.3 s. A merge, which only a maintainer
 * asks for, also stamps and publishes the result: about 2.6 s before
 * `createVersion`.
 */
export const PROPOSAL_DEFAULT_MAX_BYTES = 384 * 1024;
/** Nodes visited while measuring a document, shared ones once per visit. */
export const PRICING_YAML_MAX_VISITS = 200_000;
export const PRICING_YAML_MAX_DEPTH = 64;
/**
 * Characters of keys and strings a document may reach, counted on every visit,
 * as a multiple of its byte limit. A text without aliases never gets near it:
 * a string takes at least as many bytes in the text as characters once loaded.
 */
export const PRICING_YAML_EXPANSION_FACTOR = 2;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface VersionManager {
  LATEST_PRICING2YAML_VERSION: string;
  update(extractedPricing: unknown, useCheckpoints: boolean, pricingPath?: string): unknown;
}

interface PricingSerializer {
  serializePricing(pricing: unknown): unknown;
}

// pricing4ts only exports `.` and `./server`, and neither re-exports the updater
// or the serializer, so they are required by their paths inside the package.
const requireFromHere = createRequire(import.meta.url);
const pricing4tsServer = path.dirname(requireFromHere.resolve('pricing4ts/server'));
const versionManager = requireFromHere(path.join(pricing4tsServer, 'utils', 'version-manager.js')) as VersionManager;
const pricingSerializer = requireFromHere(
  path.join(pricing4tsServer, '..', 'main', 'utils', 'pricing-formatting', 'pricing-serializer.js')
) as PricingSerializer;

export const LATEST_SYNTAX_VERSION = versionManager.LATEST_PRICING2YAML_VERSION;

function isMapping(value: unknown): value is PricingDoc {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function invalidYaml(error: unknown): PricingYamlError {
  if (error instanceof yaml.YAMLException) {
    const line = error.mark ? error.mark.line + 1 : undefined;
    return new PricingYamlError(400, 'INVALID_PRICING', error.reason || error.message, line);
  }
  return new PricingYamlError(400, 'INVALID_PRICING', (error as Error)?.message ?? String(error));
}

function tooComplex(maxCharacters: number): PricingYamlError {
  return new PricingYamlError(
    422,
    'PRICING_TOO_COMPLEX',
    `The pricing is too complex: it may have at most ${PRICING_YAML_MAX_VISITS} values and ${maxCharacters} characters of keys and text (counting every use of an alias or merge key) nested at most ${PRICING_YAML_MAX_DEPTH} levels deep`
  );
}

/**
 * Walks a core-schema document counting every visit and the characters of
 * every key and string, without deduplicating shared references, so an alias
 * or `<<` costs its whole source every time it is used. Stops as soon as the
 * budget is spent. Forbidden keys are reported only once the whole document is
 * within budget.
 */
function measure(root: unknown, maxCharacters: number): void {
  let visits = 0;
  let characters = 0;
  let forbidden: string | undefined;
  const spend = (length: number): void => {
    characters += length;
    if (characters > maxCharacters) throw tooComplex(maxCharacters);
  };
  const visit = (node: unknown, depth: number): void => {
    visits += 1;
    if (visits > PRICING_YAML_MAX_VISITS) throw tooComplex(maxCharacters);
    if (typeof node === 'string') spend(node.length);
    if (typeof node !== 'object' || node === null) return;
    if (depth >= PRICING_YAML_MAX_DEPTH) throw tooComplex(maxCharacters);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const key of Object.keys(node)) {
      if (forbidden === undefined && FORBIDDEN_KEYS.has(key)) forbidden = key;
      spend(key.length);
      visit((node as PricingDoc)[key], depth + 1);
    }
  };
  visit(root, 0);
  if (forbidden !== undefined) {
    throw new PricingYamlError(422, 'INVALID_PRICING', `The key "${forbidden}" is not allowed in a pricing`);
  }
}

/**
 * Loads a pricing YAML text in two passes: the core schema with a budget,
 * then the default schema the parser uses. Throws a `PricingYamlError`:
 * 413 `PRICING_TOO_LARGE`, 422 `PRICING_TOO_COMPLEX`, 422 `INVALID_PRICING`
 * for forbidden keys, and 400 `INVALID_PRICING` (with its line) for YAML that
 * does not load or is not a mapping.
 */
export function loadPricingDoc(text: string, maxBytes: number): PricingDoc {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new PricingYamlError(413, 'PRICING_TOO_LARGE', `The pricing may take at most ${maxBytes} bytes`);
  }

  let core: unknown;
  try {
    core = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    throw invalidYaml(error);
  }
  measure(core, maxBytes * PRICING_YAML_EXPANSION_FACTOR);

  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.DEFAULT_SCHEMA });
  } catch (error) {
    throw invalidYaml(error);
  }
  if (!isMapping(doc)) {
    throw new PricingYamlError(400, 'INVALID_PRICING', 'A pricing must be a YAML mapping');
  }
  return doc;
}

/** Removes the keys the updaters leave set to `undefined`, which YAML cannot dump. */
function dropUndefined(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(dropUndefined);
    return;
  }
  if (!isMapping(value)) return;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
    else dropUndefined(value[key]);
  }
}

/**
 * Drops the values the latest syntax reads as absent: `variables: {}`, the
 * default `billing: { monthly: 1 }` and `tags: []`. pricing4ts writes the first
 * and leaves out the other two when it upgrades a file, and people write them
 * or not by hand, so whether they are there is never a change.
 */
function dropDefaults(doc: PricingDoc): void {
  const { variables, billing, tags } = doc;
  if (variables === null || (isMapping(variables) && Object.keys(variables).length === 0)) delete doc.variables;
  if (isMapping(billing) && Object.keys(billing).length === 1 && billing.monthly === 1) delete doc.billing;
  if (Array.isArray(tags) && tags.length === 0) delete doc.tags;
}

/**
 * A copy of the document in the latest Pricing2Yaml syntax, as SPHERE compares
 * pricings. A document in an older syntax goes through pricing4ts's own updaters
 * (in memory: no path, so nothing is written) and its serializer, so it is what
 * pricing4ts writes when it upgrades a file (`writePricingToYaml`), read back as
 * SPHERE reads files: a version upgraded on disk and the same text upgraded here
 * are equal. Defaults are dropped from every document (`dropDefaults`). The input
 * is not modified. `upgraded` tells whether it was in an older syntax.
 */
export function upgradeToLatestSyntax(doc: PricingDoc): { doc: PricingDoc; upgraded: boolean } {
  const copy = structuredClone(doc);
  const upgraded = copy.syntaxVersion !== LATEST_SYNTAX_VERSION;
  let result = copy;
  try {
    versionManager.update(copy, false);
    if (upgraded) {
      const written = pricingSerializer.serializePricing(copy);
      dropUndefined(written);
      result = yaml.load(yaml.dump(written, { noRefs: true }), { schema: yaml.DEFAULT_SCHEMA }) as PricingDoc;
    }
  } catch (error) {
    throw new PricingYamlError(422, 'PRICING_SYNTAX_UNSUPPORTED', (error as Error)?.message ?? String(error));
  }
  dropUndefined(result);
  dropDefaults(result);
  return { doc: result, upgraded };
}

/** The YAML text SPHERE writes when it has to regenerate a pricing. */
export function dumpPricingDoc(doc: PricingDoc): string {
  return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

/**
 * A pricing text in the latest syntax, which is how SPHERE compares and merges
 * pricings. A text already in it is returned as is (comments and layout kept),
 * with `loaded`, the document `loadPricingDoc` gave for it, so stamping the text
 * does not load it again; any other is upgraded and regenerated, with
 * `regenerated: true`. `doc` is the normalized document (a copy: `loaded` is
 * never changed). `original` is the text as written and its document, which is
 * what SPHERE keeps and shows: the syntax is never the author's change.
 */
export function normalizeProposalText(
  text: string,
  maxBytes: number
): { text: string; doc: PricingDoc; regenerated: boolean; loaded?: PricingDoc; original: { text: string; doc: PricingDoc } } {
  const loaded = loadPricingDoc(text, maxBytes);
  const { doc, upgraded } = upgradeToLatestSyntax(loaded);
  const original = { text, doc: loaded };
  if (!upgraded) return { text, doc, regenerated: false, loaded, original };
  return { text: dumpPricingDoc(doc), doc, regenerated: true, original };
}
