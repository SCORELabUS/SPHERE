import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FiAlertTriangle, FiCheck, FiRefreshCw } from 'react-icons/fi';
import type {
  ConflictChoice,
  ConflictScope,
  ConflictSide,
  MergeConflict,
  MergeSection,
} from '../../../pricing/types/pull-requests';
import type { MergeResolver } from '../../hooks/useMergeResolver';
import { movedActiveId } from '../../utils/pricing-merge-resolver';

const SECTION_LABELS: Record<MergeSection, string> = {
  plans: 'Plans',
  features: 'Features',
  usageLimits: 'Usage limits',
  addOns: 'Add-ons',
  general: 'General',
};

const SCOPE_LABELS: Record<ConflictScope, string> = {
  value: 'Value',
  entry: 'Whole entry',
  list: 'List',
  order: 'Order',
};

function SideValue({ title, side }: { title: string; side: ConflictSide }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-tp-steel">{title}</p>
      {side.present ? (
        <pre className="max-h-48 overflow-auto whitespace-pre rounded-lg border border-tp-hairline bg-tp-surface px-2.5 py-2 font-mono text-xs text-tp-ink">
          {side.yaml}
        </pre>
      ) : (
        <p className="rounded-lg border border-dashed border-tp-hairline-strong px-2.5 py-2 text-xs italic text-tp-steel">
          Absent
        </p>
      )}
    </div>
  );
}

function ChoiceButton({
  side,
  chosen,
  onChoose,
}: {
  side: ConflictChoice;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onChoose}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        chosen
          ? 'border-tp-primary bg-tp-primary text-tp-on-primary'
          : 'border-tp-hairline-strong bg-tp-canvas text-tp-ink hover:bg-tp-surface'
      }`}
    >
      {chosen && <FiCheck aria-hidden="true" className="h-3.5 w-3.5" />}
      {side === 'current' ? 'Keep current' : 'Use proposal'}
    </button>
  );
}

/** Whether a conflict is waiting for a choice, and why. */
function ConflictStatus({ choice, changed }: { choice?: ConflictChoice; changed: boolean }) {
  if (choice) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-tp-severity-success">
        <FiCheck aria-hidden="true" className="h-3.5 w-3.5" />
        {choice === 'current' ? 'Keeping current' : 'Using proposal'}
      </span>
    );
  }
  if (changed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-tp-severity-warning">
        <FiRefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        Changed since your choice
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-tp-severity-warning">
      <FiAlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
      Unresolved
    </span>
  );
}

/**
 * One conflict: where it is, what the base, the current version and the
 * proposal hold there (absent is not the same as `null`), and the two choices.
 */
export function ConflictCard({
  conflict,
  resolver,
  currentLabel,
  focusRequest = null,
}: {
  conflict: MergeConflict;
  resolver: MergeResolver;
  /** The version the proposal is merged into, to name the "current" side. */
  currentLabel: string;
  /** Changes each time the keyboard moves to this conflict, which then takes the focus. */
  focusRequest?: number | null;
}) {
  const { state } = resolver;
  const choice = state.choices[conflict.id];
  const active = state.activeId === conflict.id;
  const element = useRef<HTMLElement>(null);

  // Alt+↑/↓ moves the active conflict; it scrolls into view as it does...
  useEffect(() => {
    if (active) element.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  // ...and takes the focus, so Enter and Tab act on the conflict that is marked.
  useEffect(() => {
    if (focusRequest !== null) element.current?.focus?.({ preventScroll: true });
  }, [focusRequest]);

  return (
    <article
      ref={element}
      data-conflict-id={conflict.id}
      aria-current={active ? 'true' : undefined}
      aria-label={conflict.label}
      tabIndex={-1}
      className={`space-y-3 rounded-xl border p-3 outline-none focus-visible:ring-2 focus-visible:ring-tp-primary/40 sm:p-4 ${
        active ? 'border-tp-primary/60 bg-tp-canvas shadow-sm' : 'border-tp-hairline bg-tp-canvas'
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="break-all font-mono text-xs font-semibold text-tp-ink">{conflict.label}</code>
          <span className="rounded-full bg-tp-surface px-2 py-0.5 text-[11px] font-medium text-tp-slate">
            {SCOPE_LABELS[conflict.scope]}
          </span>
        </div>
        <ConflictStatus choice={choice} changed={state.changed.includes(conflict.id)} />
      </header>
      <div className="grid gap-2 sm:grid-cols-3">
        <SideValue title="Base" side={conflict.base} />
        <SideValue title={`Current · ${currentLabel}`} side={conflict.current} />
        <SideValue title="Proposal" side={conflict.proposal} />
      </div>
      <div className="flex flex-wrap gap-2">
        <ChoiceButton side="current" chosen={choice === 'current'} onChoose={() => resolver.choose(conflict.id, 'current')} />
        <ChoiceButton side="proposal" chosen={choice === 'proposal'} onChoose={() => resolver.choose(conflict.id, 'proposal')} />
      </div>
    </article>
  );
}

/** Conflicts grouped by section, then by entry, in the order the server gave them. */
function groupBySectionAndEntry(conflicts: readonly MergeConflict[]) {
  const sections = new Map<MergeSection, Map<string, MergeConflict[]>>();
  for (const conflict of conflicts) {
    const entries = sections.get(conflict.section) ?? new Map<string, MergeConflict[]>();
    const entry = conflict.entry ?? '';
    entries.set(entry, [...(entries.get(entry) ?? []), conflict]);
    sections.set(conflict.section, entries);
  }
  return sections;
}

/**
 * The Conflicts view: every conflict by section and entry, each with its three
 * values and a choice. Alt+↓ and Alt+↑ go to the next and previous conflict.
 */
export default function ConflictList({ resolver, currentLabel }: { resolver: MergeResolver; currentLabel: string }) {
  const { conflicts } = resolver.state;
  // The conflict the keyboard last moved to, and a count that changes with every move.
  const [keyboardFocus, setKeyboardFocus] = useState<{ id: string; count: number } | null>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = movedActiveId(resolver.state, step);
    resolver.move(step);
    if (next) setKeyboardFocus(previous => ({ id: next, count: (previous?.count ?? 0) + 1 }));
  };

  if (conflicts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-8 text-center text-sm text-tp-slate">
        No conflicts: the proposal and the current version can be combined as they are.
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Conflicts"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-tp-primary/40"
    >
      <p className="text-xs text-tp-steel">
        Choose a side for each conflict. <kbd className="font-mono">Alt</kbd>+<kbd className="font-mono">↓</kbd> and{' '}
        <kbd className="font-mono">Alt</kbd>+<kbd className="font-mono">↑</kbd> go to the next and previous one.
      </p>
      {[...groupBySectionAndEntry(conflicts)].map(([section, entries]) => (
        <section key={section} className="space-y-3">
          <h4 className="text-sm font-semibold text-tp-ink">{SECTION_LABELS[section]}</h4>
          {[...entries].map(([entry, items]) => (
            <div key={entry} className="space-y-2">
              {entry && <p className="break-all font-mono text-xs font-medium text-tp-slate">{entry}</p>}
              {items.map(conflict => (
                <ConflictCard
                  key={conflict.id}
                  conflict={conflict}
                  resolver={resolver}
                  currentLabel={currentLabel}
                  focusRequest={keyboardFocus?.id === conflict.id ? keyboardFocus.count : null}
                />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
