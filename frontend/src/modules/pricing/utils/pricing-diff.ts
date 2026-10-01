export type ChangeKind = 'added' | 'removed' | 'changed';

export interface FieldChange {
  /** Dotted path inside the entry, e.g. `features.apps.value`. */
  path: string;
  before: unknown;
  after: unknown;
}

export interface EntryDiff {
  name: string;
  kind: ChangeKind;
  changes: FieldChange[];
}

export type SectionKey = 'plans' | 'features' | 'addOns' | 'usageLimits';

export interface SectionDiff {
  key: SectionKey;
  label: string;
  entries: EntryDiff[];
}

export interface PricingDiff {
  /** Top-level fields that are not one of the four sections (currency, billing…). */
  general: FieldChange[];
  sections: SectionDiff[];
  totals: Record<ChangeKind, number>;
  isEmpty: boolean;
}

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'plans', label: 'Plans' },
  { key: 'features', label: 'Features' },
  { key: 'addOns', label: 'Add-ons' },
  { key: 'usageLimits', label: 'Usage limits' },
];

// `version` and `createdAt` differ by definition between two versions; the
// comparison header already shows them, so they are not reported as changes.
const IGNORED_GENERAL_KEYS = new Set<string>([
  'version',
  'createdAt',
  ...SECTIONS.map(section => section.key),
]);

type Dictionary = Record<string, unknown>;

const isDictionary = (value: unknown): value is Dictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Arrays are compared as a whole: their order is meaningful in a pricing. */
function flatten(value: unknown, prefix = ''): Map<string, unknown> {
  const flat = new Map<string, unknown>();
  if (value === null || value === undefined) return flat;
  if (!isDictionary(value)) {
    flat.set(prefix, value);
    return flat;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isDictionary(child)) {
      const nested = flatten(child, path);
      if (nested.size === 0) flat.set(path, child);
      nested.forEach((nestedValue, nestedPath) => flat.set(nestedPath, nestedValue));
    } else {
      flat.set(path, child ?? null);
    }
  }
  return flat;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diffFields(before: unknown, after: unknown): FieldChange[] {
  const flatBefore = flatten(before);
  const flatAfter = flatten(after);
  const paths = [...new Set([...flatBefore.keys(), ...flatAfter.keys()])];
  const changes: FieldChange[] = [];
  for (const path of paths) {
    const hasBefore = flatBefore.has(path);
    const hasAfter = flatAfter.has(path);
    const previous = hasBefore ? flatBefore.get(path) : undefined;
    const next = hasAfter ? flatAfter.get(path) : undefined;
    if (hasBefore && hasAfter && sameValue(previous, next)) continue;
    changes.push({ path, before: previous, after: next });
  }
  return changes;
}

function diffEntries(before: unknown, after: unknown): EntryDiff[] {
  const previous = isDictionary(before) ? before : {};
  const next = isDictionary(after) ? after : {};
  const names = [...new Set([...Object.keys(previous), ...Object.keys(next)])];
  const entries: EntryDiff[] = [];

  for (const name of names) {
    const inPrevious = name in previous;
    const inNext = name in next;
    if (inPrevious && !inNext) {
      entries.push({ name, kind: 'removed', changes: diffFields(previous[name], undefined) });
    } else if (!inPrevious && inNext) {
      entries.push({ name, kind: 'added', changes: diffFields(undefined, next[name]) });
    } else {
      const changes = diffFields(previous[name], next[name]);
      if (changes.length > 0) entries.push({ name, kind: 'changed', changes });
    }
  }
  return entries;
}

/** Structured comparison of two parsed pricing YAMLs, `before` being the older one. */
export function diffPricings(before: unknown, after: unknown): PricingDiff {
  const previous = isDictionary(before) ? before : {};
  const next = isDictionary(after) ? after : {};

  const generalBefore = Object.fromEntries(
    Object.entries(previous).filter(([key]) => !IGNORED_GENERAL_KEYS.has(key))
  );
  const generalAfter = Object.fromEntries(
    Object.entries(next).filter(([key]) => !IGNORED_GENERAL_KEYS.has(key))
  );

  const general = diffFields(generalBefore, generalAfter);
  const sections = SECTIONS.map(({ key, label }) => ({
    key,
    label,
    entries: diffEntries(previous[key], next[key]),
  }));

  const totals: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0 };
  sections.forEach(section => section.entries.forEach(entry => (totals[entry.kind] += 1)));
  totals.changed += general.length;

  return {
    general,
    sections,
    totals,
    isEmpty: totals.added + totals.removed + totals.changed === 0,
  };
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value === '' ? "''" : value;
  return JSON.stringify(value);
}
