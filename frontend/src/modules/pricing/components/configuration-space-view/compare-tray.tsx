import type { CompareSide, CompareSlots } from './compare-slots';
import { describeSelection } from './selection-mapping';

export interface CompareTrayProps {
  slots: CompareSlots;
  onClear: (side?: CompareSide) => void;
  onSwap: () => void;
  /** Whether the two held configurations differ; equal ones have nothing to show. */
  identical: boolean;
}

/**
 * The two configurations held for comparison, kept at the top of the tab.
 *
 * It is always on screen, so the mechanism explains itself before anyone scrolls: two named slots
 * that fill as you capture. The previous version put the capture behind two buttons below Quick
 * Browse -- a 1,272-row scroll container that swallows the page scroll -- where they could not be
 * reached at all.
 */
export default function CompareTray({ slots, onClear, onSwap, identical }: CompareTrayProps) {
  const filled = (slots.a ? 1 : 0) + (slots.b ? 1 : 0);

  return (
    <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-tp-steel">Compare</p>
          <p className="text-[11px] text-tp-muted">
            {filled === 0
              ? 'Hold two configurations to see what differs.'
              : filled === 1
                ? 'Hold a second one to see what differs.'
                : identical
                  ? 'Both slots hold the same configuration.'
                  : 'Showing what differs, below.'}
          </p>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          {(['a', 'b'] as const).map(side => {
            const held = slots[side];
            return (
              <div
                key={side}
                className={`flex min-w-45 flex-1 items-center gap-2 rounded-lg border px-3 py-2 ${
                  held
                    ? 'border-tp-primary bg-tp-primary/5'
                    : 'border-dashed border-tp-hairline-strong bg-tp-surface'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    held ? 'bg-tp-primary text-tp-on-primary' : 'bg-tp-hairline-soft text-tp-muted'
                  }`}
                >
                  {side.toUpperCase()}
                </span>
                <span
                  className={`truncate text-xs ${held ? 'text-tp-ink' : 'text-tp-muted italic'}`}
                >
                  {held ? describeSelection(held) : 'empty'}
                </span>
                {held && (
                  <button
                    type="button"
                    onClick={() => onClear(side)}
                    aria-label={`Clear ${side.toUpperCase()}`}
                    className="ml-auto cursor-pointer rounded p-0.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {filled > 0 && (
          <div className="flex items-center gap-2">
            {filled === 2 && (
              <button
                type="button"
                onClick={onSwap}
                className="cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1 text-xs text-tp-slate transition-colors hover:bg-tp-surface"
              >
                Swap
              </button>
            )}
            <button
              type="button"
              onClick={() => onClear()}
              className="cursor-pointer text-[11px] text-tp-steel underline underline-offset-2 hover:text-tp-ink"
            >
              Clear both
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
