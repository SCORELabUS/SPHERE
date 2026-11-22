import type {
  ConflictChoice,
  ConflictResolutions,
  ConflictSide,
  MergeConflict,
} from '../../pricing/types/pull-requests';

/**
 * The state of the merge resolver, shared by its Conflicts, YAML, Compare and
 * Visual views. The server computes the result from `choices`, so this only
 * keeps what the user decided. The result is never typed by hand: conflicts are
 * resolved by choosing a side.
 */
export interface ResolverState {
  /** The conflicts of the latest preview. */
  conflicts: MergeConflict[];
  /** The side chosen for each conflict, by id. */
  choices: ConflictResolutions;
  /** Conflicts whose values changed after the user chose a side: the choice was dropped. */
  changed: string[];
  /** The conflict the keyboard is on. */
  activeId: string | null;
}

export type ResolverAction =
  | { type: 'conflicts-loaded'; conflicts: MergeConflict[] }
  | { type: 'choose'; id: string; side: ConflictChoice }
  | { type: 'focus'; id: string }
  | { type: 'move'; step: 1 | -1 }
  /** Another merge altogether (another version proposed): no conflicts or choices until its preview. */
  | { type: 'reset' };

export function initialResolverState(conflicts: MergeConflict[] = []): ResolverState {
  return { conflicts, choices: {}, changed: [], activeId: conflicts[0]?.id ?? null };
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
      return {
        ...state,
        choices: { ...state.choices, [action.id]: action.side },
        changed: state.changed.filter(id => id !== action.id),
        activeId: action.id,
      };
    }
    case 'focus':
      return state.conflicts.some(conflict => conflict.id === action.id) ? { ...state, activeId: action.id } : state;
    case 'move': {
      const activeId = movedActiveId(state, action.step);
      return activeId === null ? state : { ...state, activeId };
    }
    case 'reset':
      return initialResolverState();
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
