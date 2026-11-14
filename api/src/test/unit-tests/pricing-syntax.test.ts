import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { retrievePricingFromText } from 'pricing4ts/server';
import {
  loadPricingDoc,
  normalizeProposalText,
  PRICING_YAML_MAX_DEPTH,
  PricingYamlError,
  PROPOSAL_DEFAULT_MAX_BYTES,
  PROPOSAL_MAX_BYTES_CEILING,
  upgradeToLatestSyntax,
} from '../../main/utils/pricing-syntax';

const MIB = 1024 * 1024;

function pricing(syntax: string, limitType = 'RENEWABLE'): string {
  const period = limitType === 'RENEWABLE' ? '    period:\n      value: 1\n      unit: MONTH\n' : '';
  return `saasName: Demo
syntaxVersion: "${syntax}"
version: "1.0"
createdAt: "2024-01-01"
currency: USD
features:
  seats:
    valueType: BOOLEAN
    defaultValue: true
    type: DOMAIN
usageLimits:
  maxSeats:
    valueType: NUMERIC
    defaultValue: 5
    unit: seat
    type: ${limitType}
${period}    linkedFeatures:
      - seats
plans:
  BASIC:
    price: 10
    features: null
    usageLimits: null
`;
}

/** Syntax 2.0 has no syntaxVersion: its `version` is the syntax. */
const PRICING_20 = pricing('2.1', 'TIME_DRIVEN')
  .replace('syntaxVersion: "2.1"\n', '')
  .replace('version: "1.0"', 'version: "2.0"');

function caught(run: () => unknown): PricingYamlError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PricingYamlError);
    return error as PricingYamlError;
  }
  throw new Error('Expected a PricingYamlError');
}

/** `a0: &a0 [x, x, ...]`, each level an array of nine aliases of the previous one. */
function billionLaughs(levels: number, width: number): string {
  const lines = [`a0: &a0 [${Array(width).fill('"lol"').join(', ')}]`];
  for (let i = 1; i < levels; i++) {
    lines.push(`a${i}: &a${i} [${Array(width).fill(`*a${i - 1}`).join(', ')}]`);
  }
  return lines.join('\n') + '\n';
}

/** `mN: &mN {<<: *m(N-1), kN: 1}`: each merge copies every key before it. */
function mergeChain(bytes: number): string {
  const lines = ['m0: &m0 {k0: 1}'];
  let size = lines[0].length;
  for (let i = 1; size < bytes; i++) {
    const line = `m${i}: &m${i} {<<: *m${i - 1}, k${i}: 1}`;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join('\n') + '\n';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadPricingDoc', () => {
  it('loads a pricing as the parser does', () => {
    const text = pricing('3.1');
    expect(loadPricingDoc(text, MIB)).toEqual(yaml.load(text));
  });

  it('refuses a text over the byte limit with 413 PRICING_TOO_LARGE, counting bytes rather than characters', () => {
    const text = `saasName: "${'ñ'.repeat(600)}"\n`;
    expect(text.length).toBeLessThan(1000);
    const error = caught(() => loadPricingDoc(text, 1000));
    expect(error.status).toBe(413);
    expect(error.code).toBe('PRICING_TOO_LARGE');
    expect(loadPricingDoc(text, 2000)).toEqual({ saasName: 'ñ'.repeat(600) });
  });

  it('takes by default ten times the largest pricing SPHERE ships, and at most 1 MiB', () => {
    // The dataset the seeders publish and the templates; `uploaded` holds what users sent.
    const root = path.resolve(process.cwd(), 'public', 'static', 'pricings');
    const sizes: number[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (file !== path.join(root, 'uploaded')) walk(file);
        } else if (/\.ya?ml$/.test(entry.name)) {
          sizes.push(fs.statSync(file).size);
        }
      }
    };
    walk(root);
    expect(sizes.length).toBeGreaterThan(100);
    expect(Math.max(...sizes) * 10).toBeLessThanOrEqual(PROPOSAL_DEFAULT_MAX_BYTES);
    expect(PROPOSAL_DEFAULT_MAX_BYTES).toBe(384 * 1024);
    expect(PROPOSAL_MAX_BYTES_CEILING).toBe(MIB);
  });

  it('refuses a 1 MiB proposal one byte over', () => {
    const text = `saasName: Demo\n#${'x'.repeat(MIB)}\n`;
    expect(caught(() => loadPricingDoc(text, MIB)).code).toBe('PRICING_TOO_LARGE');
  });

  it('stops nine levels of nine aliases with 422 PRICING_TOO_COMPLEX in under a second', () => {
    const started = Date.now();
    const error = caught(() => loadPricingDoc(billionLaughs(9, 9), MIB));
    expect(error.status).toBe(422);
    expect(error.code).toBe('PRICING_TOO_COMPLEX');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stops a ~140 KB chain of merge keys before the default schema expands it', () => {
    const text = mergeChain(140 * 1024);
    expect(text.length).toBeGreaterThan(139 * 1024);
    const load = vi.spyOn(yaml, 'load');
    const started = Date.now();
    const error = caught(() => loadPricingDoc(text, MIB));
    expect(error.status).toBe(422);
    expect(error.code).toBe('PRICING_TOO_COMPLEX');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(load).toHaveBeenCalled();
    for (const [, options] of load.mock.calls) {
      expect(options?.schema).toBe(yaml.CORE_SCHEMA);
    }
  });

  it('counts a merge source every time it is merged, not once per reference', () => {
    const keys = Array.from({ length: 1000 }, (_, i) => `k${i}: 1`).join(', ');
    const uses = Array.from({ length: 300 }, (_, i) => `e${i}: {<<: *base}`).join('\n');
    const text = `base: &base {${keys}}\n${uses}\n`;
    expect(caught(() => loadPricingDoc(text, MIB)).code).toBe('PRICING_TOO_COMPLEX');
    const fewer = `base: &base {${keys}}\n${uses.split('\n').slice(0, 100).join('\n')}\n`;
    expect(Object.keys(loadPricingDoc(fewer, MIB))).toHaveLength(101);
  });

  it('counts a long string every time an alias uses it, before anything copies it', () => {
    // 100 KB used 5000 times: 5005 visits, well within the visit budget, but 500 MB once copied.
    const uses = (count: number) => `a: &a "${'x'.repeat(100_000)}"\nb: [${Array(count).fill('*a').join(', ')}]\n`;
    const clone = vi.spyOn(globalThis, 'structuredClone');
    const started = Date.now();
    const error = caught(() => normalizeProposalText(uses(5000), MIB));
    expect(error.status).toBe(422);
    expect(error.code).toBe('PRICING_TOO_COMPLEX');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(clone).not.toHaveBeenCalled();
    // Up to twice the byte limit in characters, keys included.
    expect(loadPricingDoc(uses(19), MIB).b).toHaveLength(19);
    expect(caught(() => loadPricingDoc(uses(21), MIB)).code).toBe('PRICING_TOO_COMPLEX');
  });

  it('lets a text without aliases reach its byte limit', () => {
    const text = `saasName: "${'x'.repeat(MIB - 20)}"\n`;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MIB);
    expect(loadPricingDoc(text, MIB).saasName).toHaveLength(MIB - 20);
  });

  it(`refuses nesting deeper than ${PRICING_YAML_MAX_DEPTH} levels and alias cycles`, () => {
    const deep = `${'['.repeat(PRICING_YAML_MAX_DEPTH + 1)}1${']'.repeat(PRICING_YAML_MAX_DEPTH + 1)}`;
    expect(caught(() => loadPricingDoc(`x: ${deep}\n`, MIB)).code).toBe('PRICING_TOO_COMPLEX');
    expect(caught(() => loadPricingDoc('a: &a\n  b: *a\n', MIB)).code).toBe('PRICING_TOO_COMPLEX');
    const allowed = `${'['.repeat(PRICING_YAML_MAX_DEPTH - 2)}1${']'.repeat(PRICING_YAML_MAX_DEPTH - 2)}`;
    expect(loadPricingDoc(`x: ${allowed}\n`, MIB)).toHaveProperty('x');
  });

  it('expands a small legitimate merge key exactly as the parser does', () => {
    const text = 'saasName: Demo\ndefaults: &defaults\n  valueType: BOOLEAN\n  type: DOMAIN\nfeature:\n  <<: *defaults\n  defaultValue: true\n';
    const doc = loadPricingDoc(text, MIB);
    expect(doc).toEqual(yaml.load(text));
    expect(doc.feature).toEqual({ valueType: 'BOOLEAN', type: 'DOMAIN', defaultValue: true });
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses the key %s at any level with 422 INVALID_PRICING', (key) => {
    for (const text of [`${key}: 1\n`, `features:\n  seats:\n    ${key}:\n      polluted: true\n`]) {
      const error = caught(() => loadPricingDoc(text, MIB));
      expect(error.status).toBe(422);
      expect(error.code).toBe('INVALID_PRICING');
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reports the budget before a forbidden key', () => {
    const text = `__proto__: 1\n${billionLaughs(9, 9)}`;
    expect(caught(() => loadPricingDoc(text, MIB)).code).toBe('PRICING_TOO_COMPLEX');
  });

  it('answers 400 INVALID_PRICING with the line for YAML that does not load', () => {
    const duplicate = caught(() => loadPricingDoc('saasName: Demo\ncurrency: USD\ncurrency: EUR\n', MIB));
    expect(duplicate.status).toBe(400);
    expect(duplicate.code).toBe('INVALID_PRICING');
    expect(duplicate.line).toBe(3);
    expect(caught(() => loadPricingDoc('saasName: [\n', MIB)).code).toBe('INVALID_PRICING');
  });

  it('answers 400 INVALID_PRICING when the document is not a mapping', () => {
    for (const text of ['', '- a\n- b\n', 'just text\n']) {
      const error = caught(() => loadPricingDoc(text, MIB));
      expect(error.status).toBe(400);
      expect(error.code).toBe('INVALID_PRICING');
    }
  });
});

describe('upgradeToLatestSyntax', () => {
  it('upgrades a 2.1 document to 3.1 without touching the input', () => {
    const input = loadPricingDoc(pricing('2.1', 'TIME_DRIVEN'), MIB);
    const before = structuredClone(input);
    const { doc, upgraded } = upgradeToLatestSyntax(input);
    expect(upgraded).toBe(true);
    expect(doc.syntaxVersion).toBe('3.1');
    expect((doc.usageLimits as any).maxSeats.type).toBe('RENEWABLE');
    expect((doc.usageLimits as any).maxSeats.period).toEqual({ value: 1, unit: 'MONTH' });
    expect(input).toEqual(before);
  });

  it('leaves a 3.1 document as it is', () => {
    const input = loadPricingDoc(pricing('3.1'), MIB);
    const { doc, upgraded } = upgradeToLatestSyntax(input);
    expect(upgraded).toBe(false);
    expect(doc).toEqual(input);
    expect(doc).not.toBe(input);
  });

  it('refuses a syntax pricing4ts does not know with 422 PRICING_SYNTAX_UNSUPPORTED', () => {
    for (const syntax of ['9.9', '0.5']) {
      const error = caught(() => upgradeToLatestSyntax(loadPricingDoc(pricing(syntax), MIB)));
      expect(error.status).toBe(422);
      expect(error.code).toBe('PRICING_SYNTAX_UNSUPPORTED');
    }
  });
});

describe('normalizeProposalText', () => {
  it('returns a 3.1 text exactly as written', () => {
    const text = `# keep this comment\n${pricing('3.1')}`;
    const result = normalizeProposalText(text, MIB);
    expect(result.regenerated).toBe(false);
    expect(result.text).toBe(text);
    expect(result.doc.syntaxVersion).toBe('3.1');
  });

  it.each([
    ['2.1', pricing('2.1', 'TIME_DRIVEN')],
    ['2.0 (version as the syntax)', PRICING_20],
  ])('regenerates a %s proposal in 3.1 that the parser accepts and that stays as it is', (_name, text) => {
    const result = normalizeProposalText(text, MIB);
    expect(result.regenerated).toBe(true);
    expect(yaml.load(result.text)).toMatchObject({ syntaxVersion: '3.1' });
    expect(result.doc).toEqual(yaml.load(result.text));
    expect(retrievePricingFromText(result.text).syntaxVersion).toBe('3.1');
    expect((result.doc.usageLimits as any).maxSeats.type).toBe('RENEWABLE');
    const again = normalizeProposalText(result.text, MIB);
    expect(again.regenerated).toBe(false);
    expect(again.text).toBe(result.text);
  });

  it('brings the same pricing written in 2.1, 3.0 and 3.1 to the same document', () => {
    const docs = [pricing('2.1', 'TIME_DRIVEN'), pricing('3.0'), pricing('3.1')].map(
      (text) => normalizeProposalText(text, MIB).doc
    );
    expect(docs[0]).toEqual(docs[2]);
    expect(docs[1]).toEqual(docs[2]);
  });

  it('applies the load limits before upgrading', () => {
    expect(caught(() => normalizeProposalText(billionLaughs(9, 9), MIB)).code).toBe('PRICING_TOO_COMPLEX');
    expect(caught(() => normalizeProposalText(pricing('2.1'), 100)).code).toBe('PRICING_TOO_LARGE');
  });
});
