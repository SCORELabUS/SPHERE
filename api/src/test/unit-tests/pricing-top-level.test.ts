import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { retrievePricingFromPath, retrievePricingFromText } from 'pricing4ts/server';
import { PricingYamlError } from '../../main/utils/pricing-syntax';
import { stampTopLevel } from '../../main/utils/pricing-top-level';

const FIELDS = {
  saasName: 'Target "Pricing"',
  version: '2.0.0',
  createdAt: new Date('2025-05-25T14:30:00.000Z'),
};

const PRICING_31 = `# Pricing of Demo, edited by hand
saasName: Demo
syntaxVersion: "3.1"
version: "1.0" # the label
createdAt: "2024-01-01"
currency: USD
features:
  seats:
    # a nested key with a stamped name stays untouched
    description: "version: 1"
    valueType: BOOLEAN
    defaultValue: true
    type: DOMAIN
usageLimits:
  maxSeats:
    valueType: NUMERIC
    defaultValue: 5
    unit: seat
    type: NON_RENEWABLE
    linkedFeatures:
      - seats
plans:
  BASIC:
    version: nested
    price: 10
    features: null
    usageLimits: null
`;

/** Syntax 2.0: no syntaxVersion, and `version` is the syntax. */
const PRICING_20 = PRICING_31.replace('syntaxVersion: "3.1"\n', '')
  .replace('version: "1.0" # the label', 'version: "2.0"')
  .replace('    version: nested\n', '');

const PRICING_30 = PRICING_31.replace('syntaxVersion: "3.1"', 'syntaxVersion: "3.0"');

const tempFiles: string[] = [];

function tempFile(content: string): string {
  const file = path.join(os.tmpdir(), `stamp-${crypto.randomUUID()}.yml`);
  fs.writeFileSync(file, content);
  tempFiles.push(file);
  return file;
}

function hashOf(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function changedLines(before: string, after: string, eol = '\n'): number[] {
  const a = before.split(eol);
  const b = after.split(eol);
  expect(b).toHaveLength(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [i]));
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) fs.rmSync(file, { force: true });
});

describe('stampTopLevel', () => {
  it('changes only the three top-level lines and keeps comments, nested keys and the rest', () => {
    const { text, regenerated } = stampTopLevel(PRICING_31, FIELDS);
    expect(regenerated).toBe(false);
    const lines = text.split('\n');
    expect(changedLines(PRICING_31, text).map((i) => lines[i])).toEqual([
      'saasName: "Target \\"Pricing\\""',
      'version: "2.0.0"',
      'createdAt: "2025-05-25T14:30:00.000Z"',
    ]);
    expect(text).toContain('# Pricing of Demo, edited by hand');
    expect(text).toContain('    # a nested key with a stamped name stays untouched');
    expect(text).toContain('    version: nested');
    const parsed = retrievePricingFromText(text);
    expect(parsed.saasName).toBe('Target "Pricing"');
    expect(parsed.version).toBe('2.0.0');
  });

  it('keeps CRLF line breaks, also on inserted lines', () => {
    const crlf = PRICING_31.replace('version: "1.0" # the label\n', '').replace(/\n/g, '\r\n');
    const { text, regenerated } = stampTopLevel(crlf, FIELDS);
    expect(regenerated).toBe(false);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(text.split('\r\n').slice(1, 5)).toEqual([
      'saasName: "Target \\"Pricing\\""',
      'version: "2.0.0"',
      'syntaxVersion: "3.1"',
      'createdAt: "2025-05-25T14:30:00.000Z"',
    ]);
  });

  it('inserts missing fields: saasName first, the others after the field before them', () => {
    const bare = PRICING_31.replace('# Pricing of Demo, edited by hand\n', '')
      .replace('saasName: Demo\n', '')
      .replace('version: "1.0" # the label\n', '')
      .replace('createdAt: "2024-01-01"\n', '');
    const { text, regenerated } = stampTopLevel(bare, FIELDS);
    expect(regenerated).toBe(false);
    expect(text).toBe(
      `saasName: "Target \\"Pricing\\""\nversion: "2.0.0"\ncreatedAt: "2025-05-25T14:30:00.000Z"\n${bare}`
    );

    const withoutCreatedAt = PRICING_31.replace('createdAt: "2024-01-01"\n', '');
    const stamped = stampTopLevel(withoutCreatedAt, { createdAt: FIELDS.createdAt }).text;
    expect(stamped).toBe(
      withoutCreatedAt.replace(
        'version: "1.0" # the label\n',
        'version: "1.0" # the label\ncreatedAt: "2025-05-25T14:30:00.000Z"\n'
      )
    );
  });

  it('writes a plain date when createdAt is UTC midnight and leaves fields not asked for', () => {
    const { text } = stampTopLevel(PRICING_31, { createdAt: new Date('2025-05-25T00:00:00.000Z') });
    expect(changedLines(PRICING_31, text)).toHaveLength(1);
    expect(text).toContain('createdAt: "2025-05-25"\n');
    expect(text).toContain('saasName: Demo\n');
  });

  it('regenerates when the stamped line would not load back to the change (multi-line saasName)', () => {
    const folded = PRICING_31.replace('saasName: Demo\n', 'saasName: >\n  Demo with\n  two lines\n');
    const { text, regenerated } = stampTopLevel(folded, FIELDS);
    expect(regenerated).toBe(true);
    const doc = yaml.load(text) as Record<string, unknown>;
    expect(doc).toMatchObject({
      saasName: 'Target "Pricing"',
      version: '2.0.0',
      createdAt: '2025-05-25T14:30:00.000Z',
      syntaxVersion: '3.1',
    });
    expect(retrievePricingFromText(text).saasName).toBe('Target "Pricing"');
  });

  it('regenerates a pricing without syntaxVersion (2.0) in 3.1 with the requested label', () => {
    const { text, regenerated } = stampTopLevel(PRICING_20, FIELDS);
    expect(regenerated).toBe(true);
    const doc = yaml.load(text) as Record<string, unknown>;
    expect(doc.syntaxVersion).toBe('3.1');
    expect(doc.version).toBe('2.0.0');
    expect(Object.keys(doc).slice(0, 1)).toEqual(['saasName']);
    const parsed = retrievePricingFromText(text);
    expect(parsed.version).toBe('2.0.0');
    expect(parsed.syntaxVersion).toBe('3.1');
  });

  it('regenerates a 3.0 pricing in 3.1 even though its lines could be stamped', () => {
    const { text, regenerated } = stampTopLevel(PRICING_30, FIELDS);
    expect(regenerated).toBe(true);
    expect(yaml.load(text)).toMatchObject({ syntaxVersion: '3.1', version: '2.0.0', saasName: 'Target "Pricing"' });
  });

  it('gives a text pricing4ts publishes without rewriting it, unlike the 2.0 and 3.0 originals', () => {
    for (const source of [PRICING_20, PRICING_30]) {
      const original = tempFile(source);
      const before = hashOf(original);
      retrievePricingFromPath(original);
      expect(hashOf(original)).not.toBe(before);
    }

    for (const source of [PRICING_20, PRICING_30, PRICING_31]) {
      const file = tempFile(stampTopLevel(source, FIELDS).text);
      const hash = hashOf(file);
      expect(retrievePricingFromPath(file).version).toBe('2.0.0');
      expect(hashOf(file)).toBe(hash);
    }
  });

  it('refuses a pricing the parser rejects even after regenerating it', () => {
    const invalid = PRICING_31.replace('    type: NON_RENEWABLE\n', '    type: NOT_A_TYPE\n');
    expect(() => stampTopLevel(invalid, FIELDS)).toThrow(PricingYamlError);
    try {
      stampTopLevel(invalid, FIELDS);
    } catch (error) {
      expect((error as PricingYamlError).status).toBe(400);
      expect((error as PricingYamlError).code).toBe('INVALID_PRICING');
    }
  });
});
