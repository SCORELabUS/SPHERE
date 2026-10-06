import { useEffect, useMemo, useRef, useState } from 'react';
import jsYaml from 'js-yaml';
import {
  FiArrowRight,
  FiCheckCircle,
  FiChevronDown,
  FiCode,
  FiEdit3,
  FiList,
  FiMinusCircle,
  FiPlusCircle,
  FiRepeat,
  FiX,
} from 'react-icons/fi';
import type { IconType } from 'react-icons';
import type { VersionData } from '../../types/card';
import FileDiffView from './file-diff-view';
import {
  diffPricings,
  formatDiffValue,
  type ChangeKind,
  type EntryDiff,
  type FieldChange,
  type PricingDiff,
  type SectionDiff,
} from '../../utils/pricing-diff';

interface PricingVersionDiffProps {
  versions: VersionData[];
  /** Versions to preselect; `from` is the older one. */
  initialPair: { from: string; to: string };
}

type ViewMode = 'structured' | 'file';

const KIND_STYLES: Record<
  ChangeKind,
  {
    label: string;
    icon: IconType;
    badge: string;
    dot: string;
    tile: string;
    number: string;
    ring: string;
  }
> = {
  added: {
    label: 'Added',
    icon: FiPlusCircle,
    badge: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
    tile: 'border-emerald-200 bg-emerald-50',
    number: 'text-emerald-700',
    ring: 'ring-emerald-500',
  },
  removed: {
    label: 'Removed',
    icon: FiMinusCircle,
    badge: 'bg-red-100 text-red-800',
    dot: 'bg-red-500',
    tile: 'border-red-200 bg-red-50',
    number: 'text-red-700',
    ring: 'ring-red-500',
  },
  changed: {
    label: 'Changed',
    icon: FiEdit3,
    badge: 'bg-amber-100 text-amber-900',
    dot: 'bg-amber-500',
    tile: 'border-amber-200 bg-amber-50',
    number: 'text-amber-800',
    ring: 'ring-amber-500',
  },
};

interface LoadedVersion {
  text: string;
  parsed: unknown;
}

const API_BASE = import.meta.env.VITE_API_URL.replace('/api/v1', '');

/**
 * The API stamps absolute URLs with its own `SERVER_HOST`, which the browser
 * cannot always reach (local development). Everything under `/static` is
 * served from this page's origin in every environment, so only the path is kept.
 */
const yamlUrl = (version: VersionData) => {
  if (!version.yaml.startsWith('http')) return `${import.meta.env.VITE_API_URL}${version.yaml}`;
  try {
    const { pathname } = new URL(version.yaml);
    return pathname.startsWith('/static/') ? `${API_BASE}${pathname}` : version.yaml;
  } catch {
    return version.yaml;
  }
};

function KindBadge({ kind }: { kind: ChangeKind }) {
  const style = KIND_STYLES[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}
    >
      {style.label}
    </span>
  );
}

/** A count that doubles as a filter: pressing it keeps only that kind of change. */
function SummaryTile({
  kind,
  count,
  active,
  onToggle,
}: {
  kind: ChangeKind;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const style = KIND_STYLES[kind];
  const Icon = style.icon;
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      title={active ? 'Show all changes' : `Show only ${style.label.toLowerCase()}`}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${style.tile} ${
        disabled
          ? 'cursor-default opacity-50'
          : 'cursor-pointer hover:shadow-sm focus-visible:outline-none focus-visible:ring-2'
      } ${active ? `ring-2 ring-offset-2 ${style.ring}` : ''} ${disabled ? '' : style.ring}`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${style.number}`} />
      <div>
        <p className={`text-2xl font-semibold leading-none tabular-nums ${style.number}`}>
          {count}
        </p>
        <p className="mt-1 text-sm text-tp-slate">{style.label}</p>
      </div>
    </button>
  );
}

/** `features.apps.value` → features › apps › **value** */
function FieldPath({ path }: { path: string }) {
  const segments = path.split('.');
  const last = segments.pop();
  return (
    <span className="min-w-0 break-words text-[13px] leading-5 text-tp-steel" title={path}>
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          {segment}
          <span className="mx-1 text-tp-muted">›</span>
        </span>
      ))}
      <span className="font-medium text-tp-ink">{last}</span>
    </span>
  );
}

const valuePill = 'max-w-full break-words rounded-md px-2 py-0.5 font-mono text-[13px] leading-5';

function ChangeRow({ change, kind }: { change: FieldChange; kind: ChangeKind }) {
  return (
    <div className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-start sm:gap-4">
      <FieldPath path={change.path} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {kind !== 'added' ? (
          change.before !== undefined ? (
            <span className={`${valuePill} bg-red-100 text-red-800`}>
              {formatDiffValue(change.before)}
            </span>
          ) : (
            <span className="text-[13px] italic text-tp-steel">not set</span>
          )
        ) : null}
        {kind === 'changed' ? (
          <FiArrowRight className="h-3.5 w-3.5 shrink-0 text-tp-steel" />
        ) : null}
        {kind !== 'removed' ? (
          change.after !== undefined ? (
            <span className={`${valuePill} bg-emerald-100 text-emerald-900`}>
              {formatDiffValue(change.after)}
            </span>
          ) : (
            <span className="text-[13px] italic text-tp-steel">removed</span>
          )
        ) : null}
      </div>
    </div>
  );
}

function EntryItem({ entry }: { entry: EntryDiff }) {
  const [open, setOpen] = useState(entry.kind === 'changed' && entry.changes.length <= 6);
  const style = KIND_STYLES[entry.kind];
  const hasDetails = entry.changes.length > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-tp-hairline-strong bg-tp-canvas">
      <button
        type="button"
        onClick={() => hasDetails && setOpen(current => !current)}
        aria-expanded={hasDetails ? open : undefined}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${hasDetails ? 'cursor-pointer hover:bg-tp-surface' : 'cursor-default'}`}
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-tp-ink">
          {entry.name}
        </span>
        <KindBadge kind={entry.kind} />
        {hasDetails ? (
          <>
            <span className="hidden text-sm text-tp-slate sm:inline">
              {entry.changes.length} {entry.changes.length === 1 ? 'field' : 'fields'}
            </span>
            <FiChevronDown
              className={`h-4 w-4 shrink-0 text-tp-steel transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </>
        ) : null}
      </button>
      {hasDetails && open ? (
        <div className="divide-y divide-tp-hairline border-t border-tp-hairline bg-tp-surface/60 px-4">
          {entry.changes.map(change => (
            <ChangeRow key={change.path} change={change} kind={entry.kind} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h4 className="flex items-center gap-2 text-base font-semibold text-tp-ink">
      {children}
      {count !== undefined ? (
        <span className="rounded-full bg-tp-surface px-2 py-0.5 text-xs font-medium text-tp-slate ring-1 ring-tp-hairline">
          {count}
        </span>
      ) : null}
    </h4>
  );
}

function Section({ section }: { section: SectionDiff }) {
  if (section.entries.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionTitle count={section.entries.length}>{section.label}</SectionTitle>
      <div className="space-y-2">
        {section.entries.map(entry => (
          <EntryItem key={`${entry.kind}-${entry.name}`} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function DiffResult({
  diff,
  filter,
  onFilterChange,
}: {
  diff: PricingDiff;
  filter: ChangeKind | null;
  onFilterChange: (filter: ChangeKind | null) => void;
}) {
  // Changes in the top-level fields (currency, billing…) count as "changed".
  const showGeneral = diff.general.length > 0 && (filter === null || filter === 'changed');
  const sections = diff.sections
    .map(section => ({
      ...section,
      entries: filter ? section.entries.filter(entry => entry.kind === filter) : section.entries,
    }))
    .filter(section => section.entries.length > 0);
  const toggle = (kind: ChangeKind) => onFilterChange(filter === kind ? null : kind);

  if (diff.isEmpty) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center">
        <FiCheckCircle className="h-6 w-6 text-emerald-600" />
        <p className="text-sm font-medium text-tp-ink">These two versions are identical</p>
        <p className="text-sm text-tp-slate">
          Plans, features, add-ons and usage limits all match.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {(['added', 'removed', 'changed'] as const).map(kind => (
          <SummaryTile
            key={kind}
            kind={kind}
            count={diff.totals[kind]}
            active={filter === kind}
            onToggle={() => toggle(kind)}
          />
        ))}
      </div>
      {filter ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-tp-surface px-3 py-2 text-sm text-tp-slate">
          <span>
            Showing only{' '}
            <strong className="text-tp-ink">{KIND_STYLES[filter].label.toLowerCase()}</strong> items
          </span>
          <button
            type="button"
            onClick={() => onFilterChange(null)}
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-tp-primary hover:underline"
          >
            <FiX className="h-3.5 w-3.5" />
            Clear filter
          </button>
        </div>
      ) : null}
      {showGeneral ? (
        <section className="space-y-3">
          <SectionTitle>General</SectionTitle>
          <div className="divide-y divide-tp-hairline rounded-xl border border-tp-hairline-strong bg-tp-canvas px-4">
            {diff.general.map(change => (
              <ChangeRow key={change.path} change={change} kind="changed" />
            ))}
          </div>
        </section>
      ) : null}
      {sections.map(section => (
        <Section key={section.key} section={section} />
      ))}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  const options: { mode: ViewMode; label: string; icon: IconType }[] = [
    { mode: 'structured', label: 'Structured', icon: FiList },
    { mode: 'file', label: 'File', icon: FiCode },
  ];
  return (
    <div
      role="group"
      aria-label="Comparison view"
      className="inline-grid grid-cols-2 gap-1 rounded-xl bg-tp-surface p-1"
    >
      {options.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-1.5 text-sm font-medium transition-all ${
            value === mode
              ? 'border-tp-primary/30 bg-tp-canvas text-tp-ink shadow-sm'
              : 'border-transparent text-tp-steel hover:text-tp-ink'
          }`}
        >
          <Icon className={`h-4 w-4 ${value === mode ? 'text-tp-primary' : ''}`} />
          {label}
        </button>
      ))}
    </div>
  );
}

export default function PricingVersionDiff({ versions, initialPair }: PricingVersionDiffProps) {
  const [fromId, setFromId] = useState(initialPair.from);
  const [toId, setToId] = useState(initialPair.to);
  const [diff, setDiff] = useState<PricingDiff | null>(null);
  const [texts, setTexts] = useState<{ before: string; after: string } | null>(null);
  const [view, setView] = useState<ViewMode>('structured');
  const [filter, setFilter] = useState<ChangeKind | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const loadedCache = useRef(new Map<string, LoadedVersion>());

  // A new pair requested from outside (e.g. a row's "compare" button).
  useEffect(() => {
    setFromId(initialPair.from);
    setToId(initialPair.to);
  }, [initialPair.from, initialPair.to]);

  const fromVersion = useMemo(() => versions.find(v => v.id === fromId), [versions, fromId]);
  const toVersion = useMemo(() => versions.find(v => v.id === toId), [versions, toId]);

  useEffect(() => {
    if (!fromVersion || !toVersion) return;
    let active = true;
    const load = async (version: VersionData): Promise<LoadedVersion> => {
      const cached = loadedCache.current.get(version.id);
      if (cached) return cached;
      const response = await fetch(yamlUrl(version));
      if (!response.ok) throw new Error(`Version ${version.version} could not be loaded.`);
      const text = await response.text();
      const loaded = { text, parsed: jsYaml.load(text) };
      loadedCache.current.set(version.id, loaded);
      return loaded;
    };

    setIsLoading(true);
    setError('');
    Promise.all([load(fromVersion), load(toVersion)])
      .then(([before, after]) => {
        if (!active) return;
        setDiff(diffPricings(before.parsed, after.parsed));
        setTexts({ before: before.text, after: after.text });
      })
      .catch(loadError => {
        if (!active) return;
        setDiff(null);
        setTexts(null);
        setError(loadError instanceof Error ? loadError.message : 'The comparison failed.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fromVersion, toVersion]);

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  const selectClass =
    'h-10 w-full cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 text-sm font-medium text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10';
  const labelClass = 'mb-1.5 block text-sm font-medium text-tp-slate';

  return (
    <div className="space-y-6 rounded-2xl border border-tp-hairline bg-tp-canvas p-5 shadow-sm sm:p-6">
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <label className="block">
          <span className={labelClass}>Base version</span>
          <select
            value={fromId}
            onChange={event => setFromId(event.target.value)}
            className={selectClass}
          >
            {versions.map(version => (
              <option key={version.id} value={version.id}>
                {version.version}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={swap}
          title="Swap versions"
          aria-label="Swap versions"
          className="mx-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-tp-hairline-strong bg-tp-canvas text-tp-slate transition-colors hover:border-tp-primary/40 hover:text-tp-primary"
        >
          <FiRepeat className="h-4 w-4" />
        </button>
        <label className="block">
          <span className={labelClass}>Compared with</span>
          <select
            value={toId}
            onChange={event => setToId(event.target.value)}
            className={selectClass}
          >
            {versions.map(version => (
              <option key={version.id} value={version.id}>
                {version.version}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-6 border-t border-tp-hairline pt-6">
        <ViewToggle value={view} onChange={setView} />
        {isLoading && !diff ? (
          <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center text-sm text-tp-slate">
            Comparing versions…
          </div>
        ) : error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </div>
        ) : diff && texts && fromVersion && toVersion ? (
          <div className={`transition-opacity ${isLoading ? 'opacity-50' : ''}`}>
            {view === 'structured' ? (
              <DiffResult
                diff={diff}
                filter={filter && diff.totals[filter] > 0 ? filter : null}
                onFilterChange={setFilter}
              />
            ) : (
              <FileDiffView
                key={`${fromVersion.id}-${toVersion.id}`}
                before={texts.before}
                after={texts.after}
                beforeLabel={`${fromVersion.version}`}
                afterLabel={`${toVersion.version}`}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
