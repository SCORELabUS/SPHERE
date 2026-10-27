import { Pricing } from 'pricing4ts';

// Enough for the model to describe a change without flooding its context.
const MAX_ITEMS_PER_LIST = 40;

type Named = { name?: string; price?: unknown; unit?: string };
type Valued = { value?: unknown; defaultValue?: unknown };

export interface PricingVersionDiff {
  from: string;
  to: string;
  currency: { from: string; to: string } | null;
  plans: SectionDiff;
  addOns: SectionDiff;
  features: { added: string[]; removed: string[] };
  usageLimits: { added: string[]; removed: string[] };
  /** Values that changed inside a plan that exists in both versions. */
  planValues: Array<{ plan: string; item: string; from: unknown; to: unknown }>;
  unchanged: boolean;
}

interface SectionDiff {
  added: Array<{ name: string; price: unknown }>;
  removed: string[];
  priceChanges: Array<{ name: string; from: unknown; to: unknown }>;
}

/**
 * What changed between two versions of a pricing, by name: plans and add-ons
 * that appeared, disappeared or changed price, features and usage limits that
 * came or went, and the values each common plan gives to its features and
 * limits. It only reads the parsed pricings, so it never touches a file.
 */
export function diffPricings(from: Pricing, to: Pricing): PricingVersionDiff {
  const plans = diffSection(from.plans, to.plans);
  const addOns = diffSection(from.addOns, to.addOns);
  const features = diffKeys(from.features, to.features);
  const usageLimits = diffKeys(from.usageLimits, to.usageLimits);

  const planValues: PricingVersionDiff['planValues'] = [];
  for (const name of Object.keys(from.plans ?? {})) {
    const before = from.plans?.[name];
    const after = to.plans?.[name];
    if (!before || !after) continue;
    for (const kind of ['features', 'usageLimits'] as const) {
      const items = new Set([...Object.keys(before[kind] ?? {}), ...Object.keys(after[kind] ?? {})]);
      for (const item of items) {
        const old = effectiveValue((before[kind] as Record<string, Valued> | undefined)?.[item]);
        const now = effectiveValue((after[kind] as Record<string, Valued> | undefined)?.[item]);
        if (old !== undefined && now !== undefined && !sameValue(old, now)) {
          planValues.push({ plan: name, item, from: old, to: now });
        }
      }
    }
  }

  const currency = from.currency !== to.currency ? { from: from.currency, to: to.currency } : null;
  const unchanged =
    !currency &&
    isEmptySection(plans) &&
    isEmptySection(addOns) &&
    features.added.length + features.removed.length + usageLimits.added.length + usageLimits.removed.length === 0 &&
    planValues.length === 0;

  return {
    from: String(from.version),
    to: String(to.version),
    currency,
    plans: capSection(plans),
    addOns: capSection(addOns),
    features: { added: cap(features.added), removed: cap(features.removed) },
    usageLimits: { added: cap(usageLimits.added), removed: cap(usageLimits.removed) },
    planValues: cap(planValues),
    unchanged,
  };
}

function diffSection(before: Record<string, Named> | undefined, after: Record<string, Named> | undefined): SectionDiff {
  const old = before ?? {};
  const now = after ?? {};
  return {
    added: Object.keys(now).filter(name => !(name in old)).map(name => ({ name, price: now[name]?.price ?? null })),
    removed: Object.keys(old).filter(name => !(name in now)),
    priceChanges: Object.keys(old)
      .filter(name => name in now && !sameValue(old[name]?.price, now[name]?.price))
      .map(name => ({ name, from: old[name]?.price ?? null, to: now[name]?.price ?? null })),
  };
}

function diffKeys(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) {
  const old = Object.keys(before ?? {});
  const now = Object.keys(after ?? {});
  return { added: now.filter(key => !old.includes(key)), removed: old.filter(key => !now.includes(key)) };
}

function effectiveValue(item: Valued | undefined): unknown {
  if (!item) return undefined;
  return item.value ?? item.defaultValue;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isEmptySection(section: SectionDiff): boolean {
  return section.added.length + section.removed.length + section.priceChanges.length === 0;
}

function cap<T>(items: T[]): T[] {
  return items.slice(0, MAX_ITEMS_PER_LIST);
}

function capSection(section: SectionDiff): SectionDiff {
  return { added: cap(section.added), removed: cap(section.removed), priceChanges: cap(section.priceChanges) };
}
