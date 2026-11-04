import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Iconify from '../../../../../core/components/iconify';
import type { OrgPricing } from '../../../../api/organizationsApi';
import type { ServiceNode } from '../../../../api/serviceTreeApi';
import ServiceKindBadge from './ServiceKindBadge';
import { attributeText, labelsOf, parentOptions } from './tree';
import { KNOWN_DEPENDENCIES, KNOWN_KINDS, readLabel } from './treeJson';
import { useDismiss } from './useDismiss';

export const inputClass =
  'w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink transition-colors focus:border-tp-primary focus:outline-none';

const labelClass = 'mb-1 block text-xs font-medium text-tp-slate';

const KIND_NAMES: Record<string, string> = { AUTONOMOUS: 'Autonomous', DEPENDENT: 'Dependent' };
const DEPENDENCY_NAMES: Record<string, string> = {
  FUNCTIONAL: 'Its functionality',
  ACCOUNT: 'Only its account',
};

const shownLabel = (label: string | null, names: Record<string, string>) =>
  label ? (names[label] ?? label) : '';

interface LabelInputProps {
  value: string | null;
  known: string[];
  names: Record<string, string>;
  placeholder: string;
  onChange: (value: string | null) => void;
}

/**
 * A kind or dependency typed freely: what is typed stays as typed (spaces
 * included) while the service gets the value it means, a known one in capitals.
 */
export function LabelInput({ value, known, names, placeholder, onChange }: LabelInputProps) {
  const custom = value && !known.includes(value) ? value : null;
  const [text, setText] = useState(shownLabel(custom, names));

  // Picking a chip (or undo) clears or fills the field.
  useEffect(() => {
    setText(current =>
      readLabel(current, known) === custom ? current : shownLabel(custom, names)
    );
  }, [custom, known, names]);

  return (
    <input
      value={text}
      maxLength={40}
      placeholder={placeholder}
      onChange={e => {
        setText(e.target.value);
        onChange(readLabel(e.target.value, known));
      }}
      className={`${inputClass} py-1.5 text-xs`}
    />
  );
}

export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`max-w-[10rem] cursor-pointer truncate rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        on
          ? 'border-tp-primary/40 bg-tp-primary/10 text-tp-primary'
          : 'border-tp-hairline text-tp-steel hover:border-tp-primary/30 hover:text-tp-ink'
      }`}
    >
      {children}
    </button>
  );
}

interface KindPickerProps {
  node: ServiceNode;
  nodes: ServiceNode[];
  onChange: (changes: Partial<ServiceNode>) => void;
}

/**
 * The type of a service, from its row: a click opens the known types and those
 * the tree already uses, a field to write a new one, and what it depends on.
 */
export function KindPicker({ node, nodes, onChange }: KindPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const kinds = useMemo(() => labelsOf(nodes, n => n.kind, KNOWN_KINDS), [nodes]);
  const dependencies = useMemo(
    () => labelsOf(nodes, n => n.dependency, KNOWN_DEPENDENCIES),
    [nodes]
  );

  return (
    <div ref={ref} className="relative flex min-w-0 shrink">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-label={`Type of ${node.name || 'the service'}`}
        title="Change the type"
        className="flex min-w-0 cursor-pointer items-center rounded-full transition-opacity hover:opacity-80"
      >
        {node.kind ? (
          <ServiceKindBadge kind={node.kind} dependency={node.dependency} />
        ) : (
          <span className="whitespace-nowrap rounded-full border border-dashed border-tp-hairline-strong px-2 py-0.5 text-[11px] text-tp-steel">
            + Type
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 grid w-72 max-w-[calc(100vw-3rem)] gap-3 rounded-xl border border-tp-hairline bg-tp-canvas p-3 shadow-elevation-2">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-tp-slate">Type</span>
            <div className="flex flex-wrap gap-1">
              {kinds.map(kind => (
                <Chip key={kind} on={node.kind === kind} onClick={() => onChange({ kind })}>
                  {KIND_NAMES[kind] ?? kind}
                </Chip>
              ))}
              <Chip on={!node.kind} onClick={() => onChange({ kind: null })}>
                None
              </Chip>
            </div>
            <LabelInput
              value={node.kind}
              known={KNOWN_KINDS}
              names={KIND_NAMES}
              placeholder="Or write a new type, e.g. Add-on"
              onChange={kind => onChange({ kind })}
            />
          </div>

          {node.kind !== 'AUTONOMOUS' && (
            <div className="grid gap-1.5 border-t border-tp-hairline pt-3">
              <span className="text-xs font-medium text-tp-slate">It depends on</span>
              <div className="flex flex-wrap gap-1">
                {dependencies.map(dependency => (
                  <Chip
                    key={dependency}
                    on={node.dependency === dependency}
                    onClick={() => onChange({ dependency })}
                  >
                    {DEPENDENCY_NAMES[dependency] ?? dependency}
                  </Chip>
                ))}
                <Chip on={!node.dependency} onClick={() => onChange({ dependency: null })}>
                  Nothing
                </Chip>
              </div>
              <LabelInput
                value={node.dependency}
                known={KNOWN_DEPENDENCIES}
                names={DEPENDENCY_NAMES}
                placeholder="Or write what it needs"
                onChange={dependency => onChange({ dependency })}
              />
            </div>
          )}

          <button
            type="button"
            onClick={close}
            className="cursor-pointer justify-self-end rounded-lg bg-tp-primary px-3 py-1 text-xs font-medium text-tp-on-primary"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

interface DetailsFormProps {
  node: ServiceNode;
  nodes: ServiceNode[];
  onChange: (changes: Partial<ServiceNode>, field: string) => void;
  onMove: (parentId: string | null) => void;
}

/** What a row does not show: the description, where the service hangs, and its other fields. */
export function ServiceDetailsForm({ node, nodes, onChange, onMove }: DetailsFormProps) {
  const parents = useMemo(() => parentOptions(nodes, node.id), [nodes, node.id]);
  const attributes = Object.entries(node.attributes);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className={labelClass}>Description</span>
        <textarea
          value={node.description}
          maxLength={1000}
          rows={2}
          placeholder="What the service does"
          onChange={e => onChange({ description: e.target.value }, 'description')}
          className={`${inputClass} resize-y`}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Inside</span>
        <select
          value={node.parentId ?? ''}
          onChange={e => onMove(e.target.value || null)}
          className={`${inputClass} cursor-pointer`}
        >
          {parents.map(option => (
            <option key={option.id ?? 'top'} value={option.id ?? ''}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {attributes.length > 0 && (
        <div className="sm:col-span-2">
          <span className={labelClass}>Other fields (changed in JSON)</span>
          <dl className="grid gap-1 text-sm">
            {attributes.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 font-mono text-xs leading-5 text-tp-steel">{key}</dt>
                <dd className="min-w-0 break-words text-tp-ink">{attributeText(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

interface PickerProps {
  node: ServiceNode;
  pricings: OrgPricing[] | null;
  error: string | null;
  onToggle: (pricingId: string) => void;
}

/** Links and unlinks the organization's pricings to a service. */
export function PricingPicker({ node, pricings, error, onToggle }: PickerProps) {
  const [search, setSearch] = useState('');
  const matching = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (pricings ?? []).filter(
      pricing =>
        pricing.pricingId &&
        (!term ||
          pricing.name.toLowerCase().includes(term) ||
          pricing.collection?.name.toLowerCase().includes(term))
    );
  }, [pricings, search]);

  return (
    <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-3">
      <div className="relative">
        <Iconify
          icon="mdi:magnify"
          width={16}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tp-steel"
        />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search the organization's pricings..."
          aria-label="Search the organization's pricings"
          className={`${inputClass} pl-8`}
        />
      </div>

      <div className="mt-2 max-h-64 overflow-y-auto">
        {error ? (
          <p className="px-1 py-3 text-xs text-tp-severity-error">{error}</p>
        ) : pricings === null ? (
          <p className="flex items-center gap-2 px-1 py-3 text-xs text-tp-steel">
            <Iconify icon="mdi:loading" width={14} className="animate-spin" /> Loading pricings...
          </p>
        ) : matching.length === 0 ? (
          <p className="px-1 py-3 text-xs text-tp-steel">
            {pricings.length
              ? 'No pricing matches the search.'
              : 'This organization has no pricings yet.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {matching.map(pricing => {
              const linked = node.pricingIds.includes(pricing.pricingId!);
              return (
                <li key={pricing.pricingId}>
                  <button
                    type="button"
                    onClick={() => onToggle(pricing.pricingId!)}
                    aria-pressed={linked}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-tp-surface"
                  >
                    <Iconify
                      icon={linked ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'}
                      width={18}
                      className={linked ? 'text-tp-primary' : 'text-tp-stone'}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-tp-ink">
                      {pricing.name}
                    </span>
                    {pricing.collection && (
                      <span className="hidden truncate text-[11px] text-tp-steel sm:inline">
                        {pricing.collection.name}
                      </span>
                    )}
                    {pricing.private && (
                      <Iconify icon="mdi:lock-outline" width={13} className="text-tp-steel" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
