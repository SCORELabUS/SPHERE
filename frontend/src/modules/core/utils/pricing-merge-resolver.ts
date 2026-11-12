import type {
  ConflictChoice,
  ConflictResolutions,
  ConflictSide,
  MergeConflict,
} from '../../pricing/types/pull-requests';

/**
 * The state of the merge resolver, shared by its Conflicts, YAML, Compare and
 * Visual views. The server computes the result from `choices` (or takes
 * `manualYaml` instead), so this only keeps what the user decided.
 */
export interface ResolverState {
  /** The conflicts of the latest preview. */
  conflicts: MergeConflict[];
  /** The side chosen for each conflict, by id. */
  choices: ConflictResolutions;
  /** Conflicts whose values changed after the user chose a side: the choice was dropped. */
  changed: string[];
  /** A result typed by hand, which replaces the computed one while it is set. */
  manualYaml: string | null;
  /** The conflict the keyboard is on. */
  activeId: string | null;
}

export type ResolverAction =
  | { type: 'conflicts-loaded'; conflicts: MergeConflict[] }
  /** `confirmed` once the user agreed to drop their manual edits (see `choiceNeedsConfirmation`). */
  | { type: 'choose'; id: string; side: ConflictChoice; confirmed?: boolean }
  | { type: 'edit-manual'; yaml: string }
  | { type: 'discard-manual' }
  | { type: 'focus'; id: string }
  | { type: 'move'; step: 1 | -1 };

export function initialResolverState(conflicts: MergeConflict[] = []): ResolverState {
  return { conflicts, choices: {}, changed: [], manualYaml: null, activeId: conflicts[0]?.id ?? null };
}

const sameSide = (a: ConflictSide, b: ConflictSide) =>
  a.present === b.present && (!a.present || (b.present && a.yaml === b.yaml));

const sameValues = (a: MergeConflict, b: MergeConflict) =>
  a.scope === b.scope && sameSide(a.base, b.base) && sameSide(a.current, b.current) && sameSide(a.proposal, b.proposal);

/**
 * The choices that still hold after the preview was computed again (another
 * latest version, another proposal): a choice is kept only when its conflict
 * still has the same base, current and proposal the user saw. When any of them
 * changed, the conflict is left unresolved and marked as changed since the
 * choice, until the user chooses again. Conflicts that are gone take their
 * choice with them.
 */
export function rebaseChoices(
  previous: Pick<ResolverState, 'conflicts' | 'choices' | 'changed'>,
  next: MergeConflict[]
): Pick<ResolverState, 'choices' | 'changed'> {
  const seen = new Map(previous.conflicts.map(conflict => [conflict.id, conflict]));
  const choices: ConflictResolutions = {};
  const changed: string[] = [];
  for (const conflict of next) {
    const before = seen.get(conflict.id);
    const choice = previous.choices[conflict.id];
    if (choice && before && sameValues(before, conflict)) choices[conflict.id] = choice;
    else if (choice || previous.changed.includes(conflict.id)) changed.push(conflict.id);
  }
  return { choices, changed };
}

/** Choosing a side recomputes the result, which would replace what the user typed by hand. */
export function choiceNeedsConfirmation(state: ResolverState): boolean {
  return state.manualYaml !== null;
}

export function resolverReducer(state: ResolverState, action: ResolverAction): ResolverState {
  switch (action.type) {
    case 'conflicts-loaded': {
      const { choices, changed } = rebaseChoices(state, action.conflicts);
      const activeId = action.conflicts.some(conflict => conflict.id === state.activeId)
        ? state.activeId
        : action.conflicts[0]?.id ?? null;
      return { ...state, conflicts: action.conflicts, choices, changed, activeId };
    }
    case 'choose': {
      if (!state.conflicts.some(conflict => conflict.id === action.id)) return state;
      if (choiceNeedsConfirmation(state) && !action.confirmed) return state;
      return {
        ...state,
        choices: { ...state.choices, [action.id]: action.side },
        changed: state.changed.filter(id => id !== action.id),
        manualYaml: null,
        activeId: action.id,
      };
    }
    case 'edit-manual':
      return { ...state, manualYaml: action.yaml };
    case 'discard-manual':
      return { ...state, manualYaml: null };
    case 'focus':
      return state.conflicts.some(conflict => conflict.id === action.id) ? { ...state, activeId: action.id } : state;
    case 'move': {
      const activeId = movedActiveId(state, action.step);
      return activeId === null ? state : { ...state, activeId };
    }
  }
}

/** The conflict Alt+↓ (`1`) or Alt+↑ (`-1`) goes to, or null when there is none. */
export function movedActiveId(state: Pick<ResolverState, 'conflicts' | 'activeId'>, step: 1 | -1): string | null {
  if (state.conflicts.length === 0) return null;
  const last = state.conflicts.length - 1;
  const index = state.conflicts.findIndex(conflict => conflict.id === state.activeId);
  // Without an active conflict, Alt+↓ starts at the first one and Alt+↑ at the last; both stop at the ends.
  const next = index === -1 ? (step === 1 ? 0 : last) : Math.min(Math.max(index + step, 0), last);
  return state.conflicts[next].id;
}

export function unresolvedConflicts(state: ResolverState): MergeConflict[] {
  return state.conflicts.filter(conflict => !state.choices[conflict.id]);
}

/** The choices to send: only for conflicts of the latest preview, which the server would refuse otherwise. */
export function resolutionsOf(state: ResolverState): ConflictResolutions {
  return Object.fromEntries(
    state.conflicts.filter(conflict => state.choices[conflict.id]).map(conflict => [conflict.id, state.choices[conflict.id]])
  );
}

/**
 * A text shown as itself in Monaco's markdown hovers: every markdown character is
 * escaped, so names written by a pull request's author (a plan called
 * `![](https://…)`) never become images, links or formatting.
 */
export function escapeMarkdown(text: string): string {
  // Characters that only mean something at the start of a line (#, +, -, digits and .) are
  // left alone: the hover always starts with "Conflict: ".
  return text.replace(/[\\`*_{}[\]()!|<>~&]/g, '\\$&');
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A path as the server labels it: `plans["PRO.v2"].price`. */
export function formatConflictPath(path: readonly string[]): string {
  return path
    .map((key, index) => {
      if (!IDENTIFIER.test(key)) return `[${JSON.stringify(key)}]`;
      return index === 0 ? key : `.${key}`;
    })
    .join('');
}

export type PricingSectionKey = 'plans' | 'features' | 'addOns' | 'usageLimits';
export type RowSection = 'features' | 'usageLimits';

/**
 * Where the Visual view shows a conflict: the header of a section (its order,
 * or the whole section), the header of a plan's column, a cell of the plans ×
 * features and usage limits table, the row of a feature or a usage limit, the
 * card of an add-on, or "Other fields" for everything the table does not draw.
 */
export type ConflictTarget =
  | { kind: 'section'; section: PricingSectionKey }
  | { kind: 'plan'; plan: string }
  | { kind: 'cell'; plan: string; section: RowSection; name: string }
  | { kind: 'row'; section: RowSection; name: string }
  | { kind: 'addOn'; addOn: string }
  | { kind: 'other' };

/** The fields the Visual view draws for each kind of entry (`pricing2yaml/types.ts`). */
const PLAN_FIELDS = new Set(['description', 'price', 'unit', 'private', 'features', 'usageLimits']);
const ROW_FIELDS: Record<RowSection, Set<string>> = {
  features: new Set([
    'description',
    'tag',
    'valueType',
    'defaultValue',
    'type',
    'expression',
    'serverExpression',
    'integrationType',
    'automationType',
    'paymentType',
    'docUrl',
    'pricingUrls',
    'render',
  ]),
  usageLimits: new Set([
    'description',
    'valueType',
    'defaultValue',
    'unit',
    'type',
    'trackable',
    'period',
    'linkedFeatures',
    'render',
  ]),
};
const ADD_ON_FIELDS = new Set([
  'description',
  'price',
  'unit',
  'availableFor',
  'dependsOn',
  'excludes',
  'private',
  'subscriptionConstraints',
  'features',
  'usageLimits',
  'usageLimitsExtensions',
]);

const SECTION_KEYS = new Set<string>(['plans', 'features', 'addOns', 'usageLimits']);

const isSection = (key: string | undefined): key is PricingSectionKey => key !== undefined && SECTION_KEYS.has(key);
const isRowSection = (key: string | undefined): key is RowSection => key === 'features' || key === 'usageLimits';

function planTarget(plan: string, rest: readonly string[]): ConflictTarget {
  const [field, name, ...below] = rest;
  if (field === undefined) return { kind: 'plan', plan };
  if (!PLAN_FIELDS.has(field)) return { kind: 'other' };
  if (!isRowSection(field) || name === undefined) return { kind: 'plan', plan };
  // A plan's value of a feature or usage limit is `{ value }`.
  if (below.length === 0 || (below.length === 1 && below[0] === 'value')) return { kind: 'cell', plan, section: field, name };
  return { kind: 'other' };
}

/** Places a conflict, by its path, where the Visual view draws it. */
export function conflictTarget(path: readonly string[]): ConflictTarget {
  const [section, entry, field] = path;
  if (!isSection(section)) return { kind: 'other' };
  if (entry === undefined) return { kind: 'section', section };
  if (section === 'plans') return planTarget(entry, path.slice(2));
  const fields = section === 'addOns' ? ADD_ON_FIELDS : ROW_FIELDS[section];
  if (field !== undefined && !fields.has(field)) return { kind: 'other' };
  return section === 'addOns' ? { kind: 'addOn', addOn: entry } : { kind: 'row', section, name: entry };
}

/** A key for grouping conflicts by where they are drawn. */
export function targetKey(target: ConflictTarget): string {
  switch (target.kind) {
    case 'section':
      return JSON.stringify(['section', target.section]);
    case 'plan':
      return JSON.stringify(['plan', target.plan]);
    case 'cell':
      return JSON.stringify(['cell', target.plan, target.section, target.name]);
    case 'row':
      return JSON.stringify(['row', target.section, target.name]);
    case 'addOn':
      return JSON.stringify(['addOn', target.addOn]);
    case 'other':
      return JSON.stringify(['other']);
  }
}

/** Every conflict, once, under the key of the place the Visual view draws it, in the order given. */
export function groupConflictsByTarget(conflicts: readonly MergeConflict[]): Map<string, MergeConflict[]> {
  const groups = new Map<string, MergeConflict[]>();
  for (const conflict of conflicts) {
    const key = targetKey(conflictTarget(conflict.path));
    groups.set(key, [...(groups.get(key) ?? []), conflict]);
  }
  return groups;
}
