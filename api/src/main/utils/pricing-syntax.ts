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

// pricing4ts only exports `.` and `./server`, and the updater is not re-exported
// by either, so it is required by its path inside the package.
const requireFromHere = createRequire(import.meta.url);
const versionManager = requireFromHere(
  path.join(path.dirname(requireFromHere.resolve('pricing4ts/server')), 'utils', 'version-manager.js')
) as VersionManager;

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
 * A copy of the document in the latest Pricing2Yaml syntax, through pricing4ts's
 * own updaters (in memory: no path, so nothing is written). The input is not
 * modified. `upgraded` tells whether it was in an older syntax.
 */
export function upgradeToLatestSyntax(doc: PricingDoc): { doc: PricingDoc; upgraded: boolean } {
  const copy = structuredClone(doc);
  const upgraded = copy.syntaxVersion !== LATEST_SYNTAX_VERSION;
  try {
    versionManager.update(copy, false);
  } catch (error) {
    throw new PricingYamlError(422, 'PRICING_SYNTAX_UNSUPPORTED', (error as Error)?.message ?? String(error));
  }
  dropUndefined(copy);
  return { doc: copy, upgraded };
}

/** The YAML text SPHERE writes when it has to regenerate a pricing. */
export function dumpPricingDoc(doc: PricingDoc): string {
  return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

/**
 * A proposal as SPHERE stores it: in the latest syntax. A text already in it is
 * returned as is (comments and layout kept); any other is upgraded and
 * regenerated, with `regenerated: true`. `doc` is the normalized document.
 */
export function normalizeProposalText(
  text: string,
  maxBytes: number
): { text: string; doc: PricingDoc; regenerated: boolean } {
  const loaded = loadPricingDoc(text, maxBytes);
  const { doc, upgraded } = upgradeToLatestSyntax(loaded);
  if (!upgraded) return { text, doc, regenerated: false };
  return { text: dumpPricingDoc(doc), doc, regenerated: true };
}
