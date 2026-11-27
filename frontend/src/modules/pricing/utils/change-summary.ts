import type { PricingDiff, SectionKey } from './pricing-diff';

/** What changed in one section of a pricing (plans, features, add-ons, usage limits), by name. */
export interface SectionChanges {
  key: SectionKey;
  label: string;
  added: string[];
  removed: string[];
  changed: string[];
}

/** A short, pricing-minded reading of a diff: what a glance at a version should tell. */
export interface ChangeSummary {
  /** Only the sections with changes, in `SUMMARY_ORDER`. */
  sections: SectionChanges[];
  /** Plans and add-ons that stayed but whose price changed. */
  priceChanges: string[];
  /** Changed top-level fields that are not a section (currency, billing, url…). */
  otherFields: number;
  isEmpty: boolean;
}

/**
 * The order a summary lists its sections in: what a version offers (features and
 * their usage limits) before how it is sold (plans, then add-ons). Unlike the
 * diff's own order, which the side-by-side comparison keeps.
 */
export const SUMMARY_ORDER: readonly SectionKey[] = ['features', 'usageLimits', 'plans', 'addOns'];

const summaryRank = (key: SectionKey) => {
  const rank = SUMMARY_ORDER.indexOf(key);
  return rank === -1 ? SUMMARY_ORDER.length : rank;
};

// `price`, and the `monthlyPrice` / `annualPrice` of older Pricing2Yaml files.
const isPriceField = (path: string) => /price$/i.test(path.split('.').pop() ?? '');

export function summarizeChanges(diff: PricingDiff): ChangeSummary {
  const sections = diff.sections
    .map(section => ({
      key: section.key,
      label: section.label,
      added: section.entries.filter(entry => entry.kind === 'added').map(entry => entry.name),
      removed: section.entries.filter(entry => entry.kind === 'removed').map(entry => entry.name),
      changed: section.entries.filter(entry => entry.kind === 'changed').map(entry => entry.name),
    }))
    .filter(section => section.added.length + section.removed.length + section.changed.length > 0)
    .sort((a, b) => summaryRank(a.key) - summaryRank(b.key));

  const priceChanges = diff.sections
    .filter(section => section.key === 'plans' || section.key === 'addOns')
    .flatMap(section => section.entries)
    .filter(entry => entry.kind === 'changed' && entry.changes.some(change => isPriceField(change.path)))
    .map(entry => entry.name);

  return {
    sections,
    priceChanges,
    otherFields: diff.general.length,
    isEmpty: sections.length === 0 && diff.general.length === 0,
  };
}
