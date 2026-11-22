import type { Ref } from 'react';
import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { PreviewError } from '../../../core/components/pricing-merge-resolver';
import type { MergeResolver } from '../../../core/hooks/useMergeResolver';

const conflicts = (count: number) => `${count} ${count === 1 ? 'conflict' : 'conflicts'}`;

/**
 * Where a merge or an update stands before it is confirmed: whether the server
 * is still computing it, whether it has conflicts and how many are still open,
 * with the way into the resolver (to resolve them, or to review the result).
 */
export default function ResolutionStatus({
  resolver,
  onOpen,
  buttonRef,
}: {
  resolver: MergeResolver;
  onOpen: () => void;
  /** The button that opens the resolver, which takes the focus back when it closes. */
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { preview, error, unresolved, state } = resolver;

  if (!preview) {
    return error ? (
      <PreviewError resolver={resolver} />
    ) : (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2.5 text-sm text-tp-slate"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary"
        />
        Checking the merge…
      </p>
    );
  }

  const total = state.conflicts.length;
  const open = unresolved > 0;
  let text = 'No conflicts';
  if (open) {
    text =
      unresolved === total
        ? `${conflicts(total)} to resolve`
        : `${unresolved} of ${conflicts(total)} still to resolve`;
  } else if (total > 0) {
    text = total === 1 ? 'Conflict resolved' : `${conflicts(total)} resolved`;
  }
  const action =
    total === 0 ? 'Review the result' : open ? 'Resolve conflicts' : 'Review your choices';

  return (
    <div className="space-y-2">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
          open
            ? 'border-tp-severity-warning-border bg-tp-severity-warning-bg'
            : 'border-tp-hairline bg-tp-surface'
        }`}
      >
        <p
          aria-live="polite"
          className="inline-flex items-center gap-2 text-sm font-medium text-tp-ink"
        >
          {open ? (
            <FiAlertTriangle
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-tp-severity-warning"
            />
          ) : (
            <FiCheckCircle
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-tp-severity-success"
            />
          )}
          {text}
        </p>
        <button
          ref={buttonRef}
          type="button"
          onClick={onOpen}
          className={
            open
              ? 'cursor-pointer rounded-lg bg-tp-primary px-3 py-1.5 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep'
              : 'cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface'
          }
        >
          {action}
        </button>
      </div>
      {/* A preview asked again (after a choice) that failed: the last one is still shown. */}
      {error && <PreviewError resolver={resolver} />}
    </div>
  );
}
