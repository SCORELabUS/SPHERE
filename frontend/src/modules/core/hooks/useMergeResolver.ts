import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Pricing2YamlDocument } from '../../pricing-editor/services/pricing2yaml/linter/document';
import type { LintPosition } from '../../pricing-editor/services/pricing2yaml/linter/types';
import { PullRequestApiError } from '../../pricing/api/pricingPullRequestsApi';
import type {
  ConflictChoice,
  ConflictResolutions,
  MergeConflict,
  PullRequestPreview,
} from '../../pricing/types/pull-requests';
import customConfirm from '../utils/custom-confirm';
import {
  choiceNeedsConfirmation,
  initialResolverState,
  resolutionsOf,
  resolverReducer,
  unresolvedConflicts,
  type ResolverState,
} from '../utils/pricing-merge-resolver';
import { pullRequestMessage } from '../utils/pull-request-state';

/** How long the resolver waits after a choice that leaves no conflict open before asking for the preview again. */
export const PREVIEW_DEBOUNCE_MS = 300;
/**
 * How long it waits while conflicts are still open: previews share a budget of
 * requests a minute with merges and proposals, so a run of choices asks once.
 */
export const OPEN_CONFLICTS_DEBOUNCE_MS = 1500;
/** How long to wait after a 429 that does not say. */
export const DEFAULT_RETRY_SECONDS = 10;

export interface YamlSyntaxError {
  line: number;
  message: string;
}

/**
 * The first YAML syntax error of a text typed by hand, or null. Only the syntax
 * is checked here: whether it is a valid pricing is the server's to say, since
 * the browser's parser only reads the latest syntax.
 */
export function yamlSyntaxError(text: string): YamlSyntaxError | null {
  const document = Pricing2YamlDocument.parse(text);
  if (document.isEmpty) return { line: 1, message: 'The YAML is empty.' };
  const error = document.parserDiagnostics.find(diagnostic => diagnostic.severity === 'error');
  return error ? { line: error.startLineNumber, message: error.message } : null;
}

export interface ConflictLocation {
  conflict: MergeConflict;
  position: LintPosition;
}

/**
 * Where each conflict sits in a result text: the line of its key, or of the
 * closest key above it that the text has (a value the result left out). None
 * while the text does not parse.
 */
export function conflictLocations(text: string, conflicts: readonly MergeConflict[]): ConflictLocation[] {
  const document = Pricing2YamlDocument.parse(text);
  if (document.hasParserErrors) return [];
  return conflicts.map(conflict => ({ conflict, position: document.locate(conflict.path, 'key') }));
}

/** What a submission sends along with its own fields: the choices, the hand-typed result and the preview's token. */
export interface ResolverSubmission {
  resolutions: ConflictResolutions;
  manualYaml?: string;
  previewToken: string;
}

export interface MergeResolver {
  state: ResolverState;
  /** The latest preview the server answered; kept while a newer one loads. */
  preview: PullRequestPreview | null;
  /** Why the latest preview could not be computed. */
  error: string | null;
  /** Seconds until the preview is asked again by itself, after too many requests (429). */
  retryIn: number | null;
  /** Asks for the preview again now, with the same choices. */
  retry: () => void;
  unresolved: number;
  /** The result as it would be sent: the hand-typed one, or the server's. */
  resultYaml: string;
  /** A syntax error of the hand-typed result. */
  manualError: YamlSyntaxError | null;
  /** Why the result cannot be submitted now, in words; null when it can. */
  blockReason: string | null;
  choose: (id: string, side: ConflictChoice) => void;
  focus: (id: string) => void;
  move: (step: 1 | -1) => void;
  editManual: (yaml: string) => void;
  discardManual: () => void;
  /** What to submit, or null while `blockReason` says why not. */
  submission: () => ResolverSubmission | null;
  /**
   * The message for a refused submission. When the server says the preview no
   * longer holds (a newer version, another proposal, choices that no longer
   * match), the preview is computed again first.
   */
  submissionFailed: (caught: unknown) => string;
}

/** Refusals that mean the preview the user reviewed no longer holds. */
const STALE_CODES = new Set([
  'PREVIEW_STALE',
  'BASE_NOT_LATEST',
  'UNRESOLVED_CONFLICTS',
  'UNKNOWN_RESOLUTION',
  // A version was published while merging: the preview was computed against the one before it.
  'PRICING_CHANGED_DURING_MERGE',
]);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const isRateLimited = (caught: unknown): caught is PullRequestApiError =>
  caught instanceof PullRequestApiError && caught.status === 429;

const retryMessage = (seconds: number) =>
  `Too many requests in a short time. The preview is asked again in ${plural(seconds, 'second')}.`;

function errorMessage(caught: unknown): string {
  if (isRateLimited(caught)) {
    return caught.retryAfter !== undefined
      ? `Too many requests in a short time. Try again in ${plural(caught.retryAfter, 'second')}.`
      : 'Too many requests in a short time. Try again in a moment.';
  }
  return caught instanceof PullRequestApiError
    ? pullRequestMessage(caught.status === 404 ? 'NOT_FOUND' : caught.code, {
        message: caught.message,
        latest: caught.latest,
        number: caught.number,
      })
    : pullRequestMessage(null);
}

/**
 * The state of a merge resolver: the user's choices, the hand-typed result and
 * the preview the server computes from them. Every choice asks for the preview
 * again, so the result and its validation always come from the server.
 */
export function useMergeResolver(
  loadPreview: (resolutions: ConflictResolutions) => Promise<PullRequestPreview>
): MergeResolver {
  const [state, dispatch] = useReducer(resolverReducer, undefined, () => initialResolverState());
  const [settled, setSettled] = useState<{ request: string; error?: string } | null>(null);
  const [preview, setPreview] = useState<PullRequestPreview | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  // After a 429, the request it answered and the seconds left before asking again.
  const [rateLimited, setRateLimited] = useState<{ request: string; seconds: number } | null>(null);
  const load = useRef(loadPreview);
  load.current = loadPreview;
  // The choices of the last preview asked for; null before the first one.
  const lastChoices = useRef<string | null>(null);

  const resolutions = useMemo(() => resolutionsOf(state), [state]);
  const resolutionsKey = JSON.stringify(resolutions);
  const request = `${refreshes}:${resolutionsKey}`;
  const unresolved = unresolvedConflicts(state).length;
  // Read when a request is scheduled, without asking again when only the conflicts' count changes.
  const hasOpenConflicts = useRef(false);
  hasOpenConflicts.current = unresolved > 0;

  useEffect(() => {
    let active = true;
    // The first preview, and one asked again with the same choices, go at once; after a
    // choice the preview waits until the choices settle, longer while a conflict is open.
    const sameChoices = lastChoices.current === null || lastChoices.current === resolutionsKey;
    const delay = sameChoices ? 0 : hasOpenConflicts.current ? OPEN_CONFLICTS_DEBOUNCE_MS : PREVIEW_DEBOUNCE_MS;
    lastChoices.current = resolutionsKey;
    const timer = setTimeout(() => {
      load
        .current(JSON.parse(resolutionsKey) as ConflictResolutions)
        .then(result => {
          // A response to choices the user has changed since is dropped.
          if (!active) return;
          setPreview(result);
          setSettled({ request });
          dispatch({ type: 'conflicts-loaded', conflicts: result.conflicts });
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setSettled({ request, error: errorMessage(caught) });
          if (isRateLimited(caught)) {
            setRateLimited({ request, seconds: caught.retryAfter ?? DEFAULT_RETRY_SECONDS });
          }
        });
    }, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [request, resolutionsKey]);

  // After a 429 the same preview is asked again once the limit lets it through, counting down
  // the seconds; a new choice meanwhile asks by itself and drops the countdown.
  const retryIn = rateLimited?.request === request ? rateLimited.seconds : null;
  useEffect(() => {
    if (retryIn === null) return;
    const timer = setTimeout(() => {
      if (retryIn <= 1) setRefreshes(count => count + 1);
      else setRateLimited({ request, seconds: retryIn - 1 });
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryIn, request]);

  const isLoading = settled?.request !== request;
  const error = isLoading ? null : retryIn !== null ? retryMessage(retryIn) : (settled?.error ?? null);
  const resultYaml = state.manualYaml ?? preview?.resultYaml ?? '';
  const manualError = useMemo(
    () => (state.manualYaml === null ? null : yamlSyntaxError(state.manualYaml)),
    [state.manualYaml]
  );

  let blockReason: string | null = null;
  if (!preview) blockReason = error ?? 'Computing the merge…';
  else if (error) blockReason = error;
  else if (isLoading) blockReason = 'Updating the preview…';
  else if (state.manualYaml !== null) {
    if (manualError) blockReason = `The YAML has an error on line ${manualError.line}: ${manualError.message}`;
  } else if (unresolved > 0) blockReason = `${plural(unresolved, 'unresolved conflict')}: choose a side for each.`;
  else if (!preview.validation.ok) {
    const where = preview.validation.line ? ` (line ${preview.validation.line})` : '';
    blockReason = `The result is not a valid pricing${where}: ${preview.validation.error ?? 'the parser refused it'}`;
  }

  const choose = useCallback(
    (id: string, side: ConflictChoice) => {
      if (!choiceNeedsConfirmation(state)) {
        dispatch({ type: 'choose', id, side });
        return;
      }
      customConfirm('Choosing a side computes the result again and discards your edits to the YAML.', {
        confirmLabel: 'Discard my edits',
        cancelLabel: 'Keep editing',
      })
        .then(() => dispatch({ type: 'choose', id, side, confirmed: true }))
        .catch(() => {});
    },
    [state]
  );

  const focus = useCallback((id: string) => dispatch({ type: 'focus', id }), []);
  const move = useCallback((step: 1 | -1) => dispatch({ type: 'move', step }), []);
  const editManual = useCallback((yaml: string) => dispatch({ type: 'edit-manual', yaml }), []);
  const discardManual = useCallback(() => dispatch({ type: 'discard-manual' }), []);
  // Computes the preview again, keeping only the choices that still hold.
  const refresh = () => setRefreshes(count => count + 1);

  const submission = () => {
    if (blockReason || !preview) return null;
    return {
      resolutions,
      ...(state.manualYaml !== null ? { manualYaml: state.manualYaml } : {}),
      previewToken: preview.previewToken,
    };
  };

  const submissionFailed = (caught: unknown) => {
    if (caught instanceof PullRequestApiError && caught.code && STALE_CODES.has(caught.code)) refresh();
    return errorMessage(caught);
  };

  return {
    state,
    preview,
    error,
    retryIn,
    retry: refresh,
    unresolved,
    resultYaml,
    manualError,
    blockReason,
    choose,
    focus,
    move,
    editManual,
    discardManual,
    submission,
    submissionFailed,
  };
}
