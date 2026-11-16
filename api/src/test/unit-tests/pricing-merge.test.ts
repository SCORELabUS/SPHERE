import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { retrievePricingFromText } from 'pricing4ts/server';
import {
  applyResolutions,
  formatConflictPath,
  mergePricingDocs,
  MergeOutput,
  PricingMergeError,
  ResolvedMerge,
  semanticallyEqual,
  serializeConflictValue,
} from '../../main/utils/pricing-merge';
import { dumpPricingDoc, normalizeProposalText, PricingDoc, PricingYamlError } from '../../main/utils/pricing-syntax';

const MIB = 1024 * 1024;
const TEMPLATE = fs
  .readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8')
  .replace(/\r\n/g, '\n');
/** PetClinic in syntax 3.1: features, usage limits, plans BASIC/GOLD/PLATINUM and four add-ons. */
const BASE = normalizeProposalText(TEMPLATE, MIB).doc;

type Doc = Record<string, any>;
type Merged = MergeOutput & { doc: Doc };

const merge = (base: PricingDoc, current: PricingDoc, proposal: PricingDoc) =>
  mergePricingDocs(base, current, proposal) as Merged;
const resolve = (...args: Parameters<typeof applyResolutions>) =>
  applyResolutions(...args) as ResolvedMerge & { doc: Doc };

function variant(change: (doc: Doc) => void, from: PricingDoc = BASE): Doc {
  const doc = structuredClone(from) as Doc;
  change(doc);
  return doc;
}

function reorder(map: Doc, keys: string[]): Doc {
  expect([...keys].sort()).toEqual(Object.keys(map).sort());
  return Object.fromEntries(keys.map((key) => [key, map[key]]));
}

function caught<T extends Error>(type: new (...args: any[]) => T, run: () => unknown): T {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return error as T;
  }
  throw new Error(`Expected a ${type.name}`);
}

function parses(doc: PricingDoc): boolean {
  try {
    retrievePricingFromText(dumpPricingDoc(doc));
    return true;
  } catch {
    return false;
  }
}

/** GOLD at 7 in the current version and at 8 in the proposal. */
function priceConflict(): Merged {
  const current = variant((doc) => (doc.plans.GOLD.price = 7));
  const proposal = variant((doc) => (doc.plans.GOLD.price = 8));
  return merge(BASE, current, proposal);
}

const GOLD_PRICE = JSON.stringify(['plans', 'GOLD', 'price']);

describe('three-way pricing merge (MRG)', () => {
  it('M1: takes a change made only by the proposal as proposal-only', () => {
    const proposal = variant((doc) => (doc.plans.GOLD.price = 6));
    const output = merge(BASE, structuredClone(BASE), proposal);
    expect(output.outcome).toBe('proposal-only');
    expect(output.conflicts).toEqual([]);
    expect(output.warnings).toEqual([]);
    expect(output.doc.plans).toEqual(proposal.plans);
  });

  it('M2: reports no changes when only the current version changed, and keeps it', () => {
    const current = variant((doc) => (doc.plans.GOLD.price = 6));
    const output = merge(BASE, current, structuredClone(BASE));
    expect(output.outcome).toBe('no-changes');
    expect(output.doc).toEqual(current);
  });

  it('M3: reports no changes when both sides made the same change', () => {
    const change = (doc: Doc) => {
      doc.plans.GOLD.price = 6;
      delete doc.addOns.petAdoptionCentre;
    };
    const output = merge(BASE, variant(change), variant(change));
    expect(output.outcome).toBe('no-changes');
    expect(output.conflicts).toEqual([]);
    expect(output.doc.plans.GOLD.price).toBe(6);
    expect(output.doc.addOns).not.toHaveProperty('petAdoptionCentre');
  });

  it('M4: combines disjoint changes and warns that the text is written again (CA-40)', () => {
    const current = variant((doc) => (doc.plans.GOLD.price = 6));
    const proposal = variant((doc) => (doc.plans.PLATINUM.description = 'Everything'));
    const output = merge(BASE, current, proposal);
    expect(output.outcome).toBe('merged');
    expect(output.conflicts).toEqual([]);
    expect(output.warnings).toEqual([{ code: 'FORMAT_REGENERATED' }]);
    expect(output.doc.plans.GOLD.price).toBe(6);
    expect(output.doc.plans.PLATINUM.description).toBe('Everything');
    expect(parses(output.doc)).toBe(true);
  });

  it('M5: turns two different values into one conflict with its label and three values (CA-24)', () => {
    const output = priceConflict();
    expect(output.outcome).toBe('conflicts');
    expect(output.conflicts).toEqual([
      {
        id: GOLD_PRICE,
        path: ['plans', 'GOLD', 'price'],
        label: 'plans.GOLD.price',
        section: 'plans',
        entry: 'GOLD',
        scope: 'value',
        base: { present: true, yaml: '5\n' },
        current: { present: true, yaml: '7\n' },
        proposal: { present: true, yaml: '8\n' },
      },
    ]);
    expect(output.doc.plans.GOLD.price).toBe(7);
    expect(output.warnings).toContainEqual({ code: 'FORMAT_REGENERATED' });

    const kept = resolve(output, { [GOLD_PRICE]: 'current' }, { requireAll: true });
    expect(kept.doc.plans.GOLD.price).toBe(7);
    expect(kept.outcome).toBe('no-changes');
    const taken = resolve(output, { [GOLD_PRICE]: 'proposal' }, { requireAll: true });
    expect(taken.doc.plans.GOLD.price).toBe(8);
    expect(taken.outcome).toBe('proposal-only');
    expect(taken.unresolved).toEqual([]);
  });

  it('M6: makes deleting an entry the other side modified one conflict on the whole entry (CA-25)', () => {
    const current = variant((doc) => {
      delete doc.plans.GOLD;
      doc.plans.BASIC.description = 'Free';
    });
    const proposal = variant((doc) => {
      doc.plans.GOLD.price = 6;
      doc.plans.GOLD.features.consultations.value = true;
    });
    const output = merge(BASE, current, proposal);
    expect(output.conflicts).toHaveLength(1);
    const [conflict] = output.conflicts;
    expect(conflict).toMatchObject({ path: ['plans', 'GOLD'], scope: 'entry', entry: 'GOLD', current: { present: false } });
    expect(conflict.proposal).toMatchObject({ present: true });
    expect(output.doc.plans).not.toHaveProperty('GOLD');

    const kept = resolve(output, { [conflict.id]: 'current' }, { requireAll: true });
    expect(kept.doc.plans).not.toHaveProperty('GOLD');
    expect(kept.doc.plans.BASIC.description).toBe('Free');
    const taken = resolve(output, { [conflict.id]: 'proposal' }, { requireAll: true });
    expect(taken.doc.plans.GOLD).toEqual(proposal.plans.GOLD);
    expect(taken.doc.plans.BASIC.description).toBe('Free');
    expect(taken.outcome).toBe('merged');

    const reverse = merge(BASE, proposal, current);
    expect(reverse.conflicts).toMatchObject([{ path: ['plans', 'GOLD'], scope: 'entry', proposal: { present: false } }]);
  });

  it('M7: makes the same entry added twice with different content one entry conflict, and merges it when equal', () => {
    const enterprise = { description: 'Enterprise', price: 50, unit: 'user/month', features: null, usageLimits: null };
    const current = variant((doc) => (doc.plans.ENTERPRISE = { ...enterprise }));
    const proposal = variant((doc) => (doc.plans.ENTERPRISE = { ...enterprise, price: 60 }));
    const output = merge(BASE, current, proposal);
    expect(output.conflicts).toMatchObject([
      { path: ['plans', 'ENTERPRISE'], scope: 'entry', base: { present: false } },
    ]);

    const same = merge(BASE, current, variant((doc) => (doc.plans.ENTERPRISE = { ...enterprise })));
    expect(same.conflicts).toEqual([]);
    expect(same.outcome).toBe('no-changes');
    expect(same.doc.plans.ENTERPRISE).toEqual(enterprise);
  });

  it('M8: merges reference lists as sets, adding and removing what the proposal did (CA-26)', () => {
    const current = variant((doc) => doc.usageLimits.maxPets.linkedFeatures.push('visits'));
    const proposal = variant((doc) => (doc.usageLimits.maxPets.linkedFeatures = ['haveCalendar']));
    const output = merge(BASE, current, proposal);
    expect(output.conflicts).toEqual([]);
    expect(output.outcome).toBe('merged');
    expect(output.doc.usageLimits.maxPets.linkedFeatures).toEqual(['visits', 'haveCalendar']);
  });

  it('M9: makes any other list changed differently on both sides one list conflict (CA-26)', () => {
    const base = variant((doc) => (doc.tags = ['pets']));
    const current = variant((doc) => doc.tags.push('vets'), base);
    const proposal = variant((doc) => doc.tags.push('clinics'), base);
    const output = merge(base, current, proposal);
    expect(output.conflicts).toMatchObject([
      {
        path: ['tags'],
        section: 'general',
        scope: 'list',
        current: { present: true, yaml: '- pets\n- vets\n' },
        proposal: { present: true, yaml: '- pets\n- clinics\n' },
      },
    ]);
    expect(output.doc.tags).toEqual(['pets', 'vets']);
  });

  it('M10: names a key with dots in brackets and keeps it whole in the id', () => {
    const base = variant((doc) => (doc.plans['PRO.v2'] = { price: 1, unit: 'user/month', features: null, usageLimits: null }));
    const current = variant((doc) => (doc.plans['PRO.v2'].price = 2), base);
    const proposal = variant((doc) => (doc.plans['PRO.v2'].price = 3), base);
    const [conflict] = merge(base, current, proposal).conflicts;
    expect(conflict.label).toBe('plans["PRO.v2"].price');
    expect(conflict.id).toBe('["plans","PRO.v2","price"]');
    expect(conflict.entry).toBe('PRO.v2');
    expect(formatConflictPath(['my plans', 'a'])).toBe('["my plans"].a');
  });

  it('M11: tells an absent key from a null one', () => {
    const current = variant((doc) => delete doc.plans.BASIC.unit);
    const proposal = variant((doc) => (doc.plans.BASIC.unit = null));
    const output = merge(BASE, current, proposal);
    expect(output.conflicts).toMatchObject([
      { path: ['plans', 'BASIC', 'unit'], current: { present: false }, proposal: { present: true, yaml: 'null\n' } },
    ]);

    const onlyNull = merge(BASE, structuredClone(BASE), proposal);
    expect(onlyNull.outcome).toBe('proposal-only');
    expect(onlyNull.doc.plans.BASIC).toHaveProperty('unit', null);
  });

  it('M12: never compares version, createdAt or saasName, and keeps those of the current version (CA-12)', () => {
    const renamed = (doc: Doc) => {
      doc.saasName = 'PetClinic fork';
      doc.version = '9.9';
      doc.createdAt = '2030-01-01';
    };
    expect(merge(BASE, structuredClone(BASE), variant(renamed)).outcome).toBe('no-changes');

    const current = variant((doc) => (doc.version = '2.0.0'));
    const proposal = variant((doc) => {
      renamed(doc);
      doc.plans.GOLD.price = 6;
    });
    const output = merge(BASE, current, proposal);
    expect(output.outcome).toBe('proposal-only');
    expect(output.conflicts).toEqual([]);
    expect(output.doc).toMatchObject({ saasName: 'PetClinic', version: '2.0.0', createdAt: BASE.createdAt });
  });

  it('M13: compares 2.1, 3.0 and 3.1 texts of the same pricing as equal once upgraded (CA-69)', () => {
    const v21 = TEMPLATE.replace('syntaxVersion: "3.0"', 'syntaxVersion: "2.1"').replace(
      '    type: RENEWABLE\n    period:\n      value: 1\n      unit: MONTH\n',
      '    type: TIME_DRIVEN\n'
    );
    const v31 = TEMPLATE.replace('syntaxVersion: "3.0"', 'syntaxVersion: "3.1"');
    const [base, current, proposal] = [v21, TEMPLATE, v31].map((text) => normalizeProposalText(text, MIB));
    expect([base.regenerated, current.regenerated, proposal.regenerated]).toEqual([true, true, false]);
    expect(base.doc.usageLimits).toMatchObject({ maxVisitsPerMonthAndPet: { type: 'RENEWABLE', period: { value: 1, unit: 'MONTH' } } });
    expect(merge(base.doc, current.doc, proposal.doc).outcome).toBe('no-changes');

    const changed = merge(
      base.doc,
      variant((doc) => (doc.plans.GOLD.price = 6), current.doc),
      variant((doc) => (doc.plans.PLATINUM.price = 12), proposal.doc)
    );
    expect(changed.outcome).toBe('merged');
    expect(changed.conflicts).toEqual([]);
  });

  it('M14: merges changes to different fields of the same nested mappings', () => {
    const current = variant((doc) => (doc.plans.GOLD.features.haveCalendar.value = false));
    const proposal = variant((doc) => {
      doc.plans.GOLD.features.consultations.value = true;
      doc.plans.GOLD.usageLimits.maxPets.value = 5;
    });
    const output = merge(BASE, current, proposal);
    expect(output.outcome).toBe('merged');
    expect(output.conflicts).toEqual([]);
    expect(output.doc.plans.GOLD.features.haveCalendar.value).toBe(false);
    expect(output.doc.plans.GOLD.features.consultations.value).toBe(true);
    expect(output.doc.plans.GOLD.usageLimits.maxPets.value).toBe(5);
  });

  it('M15: keeps __proto__ and constructor as plain keys without touching any prototype', () => {
    const current = variant((doc) => (doc.plans.GOLD.price = 6));
    const proposal = variant((doc) => {
      doc.plans.GOLD = { ...doc.plans.GOLD, ...JSON.parse('{"__proto__": {"polluted": true}}') };
      Object.assign(doc, JSON.parse('{"constructor": "kept"}'));
    });
    expect(Object.prototype.hasOwnProperty.call(proposal.plans.GOLD, '__proto__')).toBe(true);
    const output = merge(BASE, current, proposal);
    const gold = output.doc.plans.GOLD;
    expect(output.outcome).toBe('merged');
    expect(Object.prototype.hasOwnProperty.call(gold, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(gold)).toBe(Object.prototype);
    expect(gold.polluted).toBeUndefined();
    expect(({} as Doc).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(output.doc, 'constructor')).toBe(true);
    expect(output.doc.constructor).toBe('kept');
  });

  it('M16: ignores the order of keys inside entries', () => {
    const proposal = variant((doc) => (doc.plans.GOLD = reorder(doc.plans.GOLD, ['usageLimits', 'price', 'features', 'unit', 'description'])));
    expect(semanticallyEqual(proposal, BASE)).toBe(true);
    expect(merge(BASE, structuredClone(BASE), proposal).outcome).toBe('no-changes');

    const current = variant((doc) => (doc.plans.GOLD = reorder(doc.plans.GOLD, ['price', 'description', 'unit', 'features', 'usageLimits'])));
    const priced = variant((doc) => (doc.plans.GOLD.price = 6));
    const output = merge(BASE, current, priced);
    expect(output.outcome).toBe('proposal-only');
    expect(output.doc.plans.GOLD.price).toBe(6);
  });

  it('M17: deletes an entry both sides deleted', () => {
    const current = variant((doc) => {
      delete doc.addOns.petAdoptionCentre;
      doc.plans.GOLD.price = 6;
    });
    const proposal = variant((doc) => {
      delete doc.addOns.petAdoptionCentre;
      doc.plans.PLATINUM.price = 12;
    });
    const output = merge(BASE, current, proposal);
    expect(output.outcome).toBe('merged');
    expect(output.conflicts).toEqual([]);
    expect(output.doc.addOns).not.toHaveProperty('petAdoptionCentre');
  });

  it('M18: deletes an entry one side deleted and the other left alone', () => {
    const deleted = variant((doc) => delete doc.addOns.petAdoptionCentre);
    const priced = variant((doc) => (doc.plans.GOLD.price = 6));
    for (const [current, proposal] of [
      [deleted, priced],
      [priced, deleted],
    ]) {
      const output = merge(BASE, current, proposal);
      expect(output.outcome).toBe('merged');
      expect(output.conflicts).toEqual([]);
      expect(output.doc.addOns).not.toHaveProperty('petAdoptionCentre');
      expect(output.doc.plans.GOLD.price).toBe(6);
    }
  });

  it('M19: makes a change of type against a change inside it one conflict on the whole value', () => {
    const current = variant((doc) => (doc.plans.GOLD.features = null));
    const proposal = variant((doc) => (doc.plans.GOLD.features.haveCalendar.value = false));
    const output = merge(BASE, current, proposal);
    expect(output.conflicts).toMatchObject([
      { path: ['plans', 'GOLD', 'features'], scope: 'value', current: { present: true, yaml: 'null\n' } },
    ]);
    expect(output.doc.plans.GOLD.features).toBeNull();
  });

  it('M20: refuses missing resolutions when all are required and unknown ones always', () => {
    const output = priceConflict();
    const before = structuredClone(output.doc);

    const missing = caught(PricingMergeError, () => resolve(output, {}, { requireAll: true }));
    expect(missing).toMatchObject({ status: 409, code: 'UNRESOLVED_CONFLICTS', conflictIds: [GOLD_PRICE] });

    const partial = resolve(output, {}, { requireAll: false });
    expect(partial.outcome).toBe('conflicts');
    expect(partial.unresolved).toEqual([GOLD_PRICE]);
    expect(partial.doc.plans.GOLD.price).toBe(7);

    const otherId = JSON.stringify(['plans', 'BASIC', 'price']);
    for (const resolutions of [{ [GOLD_PRICE]: 'current', [otherId]: 'proposal' }, { [GOLD_PRICE]: 'both' }]) {
      const unknown = caught(PricingMergeError, () => resolve(output, resolutions, { requireAll: true }));
      expect(unknown).toMatchObject({ status: 422, code: 'UNKNOWN_RESOLUTION' });
    }

    resolve(output, { [GOLD_PRICE]: 'proposal' }, { requireAll: true });
    expect(output.doc).toEqual(before);
  });

  it('M21: stops a merge past its node budget or nesting limit with 422 PRICING_TOO_COMPLEX', () => {
    // 3,000 plans sharing one list of 1,000 values cost 3,000,000 visits to compare.
    const withSharedList = () => {
      const shared = Array.from({ length: 1000 }, (_, i) => i);
      return variant((doc) => {
        for (let i = 0; i < 3000; i++) doc.plans[`P${i}`] = { price: 1, tags: shared };
      });
    };
    const started = Date.now();
    const budget = caught(PricingYamlError, () => merge(BASE, withSharedList(), withSharedList()));
    expect(budget).toMatchObject({ status: 422, code: 'PRICING_TOO_COMPLEX' });
    expect(Date.now() - started).toBeLessThan(2000);

    const cyclic = () =>
      variant((doc) => {
        doc.plans.GOLD.self = doc.plans.GOLD;
      });
    const depth = caught(PricingYamlError, () => merge(BASE, cyclic(), cyclic()));
    expect(depth).toMatchObject({ status: 422, code: 'PRICING_TOO_COMPLEX' });
  });

  it('M22: leaves an invalid combination of valid sides to the parser, without a conflict', () => {
    const current = variant((doc) => {
      delete doc.features.haveCalendar;
      delete doc.plans.GOLD.features.haveCalendar;
      delete doc.plans.PLATINUM.features.haveCalendar;
    });
    const proposal = variant((doc) => (doc.plans.BASIC.features = { haveCalendar: { value: true } }));
    expect(parses(current)).toBe(true);
    expect(parses(proposal)).toBe(true);
    const output = merge(BASE, current, proposal);
    expect(output.outcome).toBe('merged');
    expect(output.conflicts).toEqual([]);
    expect(parses(output.doc)).toBe(false);
  });

  it('M23: takes a manual result over the resolutions and the computed merge', () => {
    const output = priceConflict();
    const manual = variant((doc) => (doc.plans.GOLD.price = 9));
    const resolved = resolve(output, { [GOLD_PRICE]: 'proposal' }, { requireAll: true, manual });
    expect(resolved.doc.plans.GOLD.price).toBe(9);
    expect(resolved.unresolved).toEqual([]);
    expect(resolved.outcome).toBe('merged');
    expect(resolved.warnings).toEqual([{ code: 'MANUAL_OVERRIDE' }]);

    expect(resolve(output, {}, { requireAll: true, manual }).doc.plans.GOLD.price).toBe(9);
    const unknown = caught(PricingMergeError, () =>
      resolve(output, { '["nope"]': 'current' }, { requireAll: true, manual })
    );
    expect(unknown.code).toBe('UNKNOWN_RESOLUTION');
  });

  it('M24: reports a conflict outside the four sections in general', () => {
    const current = variant((doc) => (doc.url = 'https://petclinic.example/pricing'));
    const proposal = variant((doc) => (doc.url = 'https://petclinic.example/plans'));
    const [conflict] = merge(BASE, current, proposal).conflicts;
    expect(conflict).toMatchObject({ id: '["url"]', label: 'url', section: 'general', scope: 'value', base: { present: false } });
    expect(conflict).not.toHaveProperty('entry');
  });

  it('M25: takes a proposal that only reorders plans as proposal-only, in its order (CA-94)', () => {
    const order = ['PLATINUM', 'GOLD', 'BASIC'];
    const proposal = variant((doc) => (doc.plans = reorder(doc.plans, order)));
    expect(semanticallyEqual(proposal, BASE)).toBe(true);
    const output = merge(BASE, structuredClone(BASE), proposal);
    expect(output.outcome).toBe('proposal-only');
    expect(Object.keys(output.doc.plans)).toEqual(order);
  });

  it('M25b: keeps the order of the only side that reordered when both sides changed (CA-94)', () => {
    const order = ['PLATINUM', 'GOLD', 'BASIC'];
    const current = variant((doc) => {
      doc.plans.GOLD.price = 6;
      doc.plans.ENTERPRISE = { price: 50, unit: 'user/month', features: null, usageLimits: null };
    });
    const proposal = variant((doc) => (doc.plans = reorder(doc.plans, order)));
    // ENTERPRISE follows PLATINUM in the current version, so it goes right after it.
    const merged = ['PLATINUM', 'ENTERPRISE', 'GOLD', 'BASIC'];
    const output = merge(BASE, current, proposal);
    expect(output.outcome).toBe('merged');
    expect(Object.keys(output.doc.plans)).toEqual(merged);
    expect(output.doc.plans.GOLD.price).toBe(6);

    const reversed = merge(BASE, proposal, current);
    expect(Object.keys(reversed.doc.plans)).toEqual(merged);
  });

  it('M26: makes two different reorderings of a section one order conflict (CA-94)', () => {
    const currentOrder = ['GOLD', 'BASIC', 'PLATINUM'];
    const proposalOrder = ['PLATINUM', 'GOLD', 'BASIC'];
    const current = variant((doc) => (doc.plans = reorder(doc.plans, currentOrder)));
    const proposal = variant((doc) => (doc.plans = reorder(doc.plans, proposalOrder)));
    const output = merge(BASE, current, proposal);
    expect(output.conflicts).toEqual([
      {
        id: '["plans"]',
        path: ['plans'],
        label: 'Order of plans',
        section: 'plans',
        scope: 'order',
        base: { present: true, yaml: '- BASIC\n- GOLD\n- PLATINUM\n' },
        current: { present: true, yaml: '- GOLD\n- BASIC\n- PLATINUM\n' },
        proposal: { present: true, yaml: '- PLATINUM\n- GOLD\n- BASIC\n' },
      },
    ]);
    expect(Object.keys(output.doc.plans)).toEqual(currentOrder);
    expect(Object.keys(resolve(output, { '["plans"]': 'proposal' }, { requireAll: true }).doc.plans)).toEqual(
      proposalOrder
    );
    expect(Object.keys(resolve(output, { '["plans"]': 'current' }, { requireAll: true }).doc.plans)).toEqual(
      currentOrder
    );

    expect(merge(BASE, current, structuredClone(current)).conflicts).toEqual([]);
  });

  it('M27: compares dates by their time', () => {
    const base = variant((doc) => (doc.releasedAt = new Date('2024-01-01T00:00:00Z')));
    expect(merge(base, structuredClone(base), structuredClone(base)).outcome).toBe('no-changes');
    const proposal = variant((doc) => (doc.releasedAt = new Date('2024-02-01T00:00:00Z')), base);
    const output = merge(base, structuredClone(base), proposal);
    expect(output.outcome).toBe('proposal-only');
    expect(output.doc.releasedAt.getTime()).toBe(Date.parse('2024-02-01T00:00:00Z'));
    expect(semanticallyEqual(base, proposal)).toBe(false);
  });

  it('M28: takes NaN as equal to NaN', () => {
    const base = variant((doc) => (doc.variables = { ratio: NaN }));
    expect(merge(base, structuredClone(base), structuredClone(base)).outcome).toBe('no-changes');
    const current = variant((doc) => (doc.plans.GOLD.price = 6), base);
    const proposal = variant((doc) => (doc.plans.PLATINUM.price = 12), base);
    const output = merge(base, current, proposal);
    expect(output.outcome).toBe('merged');
    expect(output.conflicts).toEqual([]);
    expect(output.doc.variables.ratio).toBeNaN();
  });

  it('M29: writes conflict sides as YAML, keeping .inf, dates, null and absent apart', () => {
    const base = variant((doc) => (doc.releasedAt = new Date('2024-01-01T00:00:00Z')));
    const current = variant((doc) => {
      doc.plans.GOLD.usageLimits.maxPets.value = Infinity;
      doc.releasedAt = new Date('2024-02-01T00:00:00Z');
    }, base);
    const proposal = variant((doc) => {
      doc.plans.GOLD.usageLimits.maxPets.value = 5;
      doc.releasedAt = new Date('2024-03-01T00:00:00Z');
    }, base);
    const conflicts = merge(base, current, proposal).conflicts;
    expect(conflicts.find((conflict) => conflict.label === 'plans.GOLD.usageLimits.maxPets.value')).toMatchObject({
      base: { yaml: '4\n' },
      current: { yaml: '.inf\n' },
      proposal: { yaml: '5\n' },
    });
    expect(conflicts.find((conflict) => conflict.label === 'releasedAt')).toMatchObject({
      current: { yaml: '2024-02-01T00:00:00.000Z\n' },
      proposal: { yaml: '2024-03-01T00:00:00.000Z\n' },
    });
    expect(serializeConflictValue({ present: true, value: null })).toEqual({ present: true, yaml: 'null\n' });
    expect(serializeConflictValue({ present: false })).toEqual({ present: false });
  });

  it('M30: turns a reference the proposal adds to an entry the current version deleted into a conflict', () => {
    const current = variant((doc) => delete doc.plans.BASIC);
    const proposal = variant((doc) => doc.addOns.havePetsDashboard.availableFor.push('BASIC'));
    const output = merge(BASE, current, proposal);
    expect(output.outcome).toBe('conflicts');
    expect(output.conflicts).toMatchObject([
      {
        path: ['addOns', 'havePetsDashboard', 'availableFor'],
        scope: 'value',
        current: { present: true, yaml: '- PLATINUM\n' },
        proposal: { present: true, yaml: '- PLATINUM\n- BASIC\n' },
      },
    ]);
    expect(output.doc.addOns.havePetsDashboard.availableFor).toEqual(['PLATINUM']);
    expect(output.doc.plans).not.toHaveProperty('BASIC');

    const existing = variant((doc) => doc.addOns.havePetsDashboard.availableFor.push('GOLD'));
    const fine = merge(BASE, current, existing);
    expect(fine.conflicts).toEqual([]);
    expect(fine.doc.addOns.havePetsDashboard.availableFor).toEqual(['PLATINUM', 'GOLD']);
  });

  it('M31: warns with GLOBAL_FIELD_CHANGED when the current version changed the currency and the proposal a price', () => {
    const current = variant((doc) => (doc.currency = 'USD'));
    const priced = merge(BASE, current, variant((doc) => (doc.plans.GOLD.price = 6)));
    expect(priced.warnings).toContainEqual({ code: 'GLOBAL_FIELD_CHANGED', fields: ['currency'] });

    const described = merge(BASE, current, variant((doc) => (doc.plans.GOLD.description = 'Gold')));
    expect(described.outcome).toBe('merged');
    expect(described.warnings).toEqual([{ code: 'FORMAT_REGENERATED' }]);
  });

  it('T13: the merge engine imports no file system module', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'main', 'utils', 'pricing-merge.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"](node:)?fs(\/promises)?['"]/);
    expect(source).not.toMatch(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/);
  });
});
