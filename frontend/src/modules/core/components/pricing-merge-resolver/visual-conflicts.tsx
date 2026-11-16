import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import jsYaml from 'js-yaml';
import { FiAlertTriangle, FiCheck } from 'react-icons/fi';
import {
  getFeatureGroups,
  orderFeaturesByGroup,
  parseDraftFromYaml,
  type PricingDraft,
} from '../../../pricing-editor/services/pricing2yaml';
import { CURRENCIES, LABEL_WIDTH } from '../../../pricing-editor/components/visual-editor/utils/constants';
import { VisualEditorUnavailable } from '../../../pricing-editor/components/visual-editor/components/VisualEditorUnavailable';
import type { MergeConflict } from '../../../pricing/types/pull-requests';
import type { MergeResolver } from '../../hooks/useMergeResolver';
import {
  conflictTarget,
  groupConflictsByTarget,
  targetKey,
  type ConflictTarget,
  type RowSection,
} from '../../utils/pricing-merge-resolver';
import { ConflictCard } from './conflict-list';

type ParsedResult =
  | { ok: true; draft: PricingDraft; raw: Record<string, unknown> }
  | { ok: false; message: string };

function parseResult(text: string): ParsedResult {
  try {
    const raw = jsYaml.load(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, message: 'The result is not a YAML mapping.' };
    }
    return { ok: true, raw: raw as Record<string, unknown>, draft: parseDraftFromYaml(text) };
  } catch (caught) {
    return { ok: false, message: caught instanceof Error ? caught.message : String(caught) };
  }
}

/** The value of the result at a path, written as YAML, or null when the result has none there. */
function resultValueAt(raw: Record<string, unknown>, path: readonly string[]): string | null {
  let node: unknown = raw;
  for (const key of path) {
    if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, key)) return null;
    node = (node as Record<string, unknown>)[key];
  }
  return jsYaml.dump(node, { lineWidth: -1, noRefs: true });
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatPrice(price: unknown, currency: string | undefined): string {
  if (typeof price !== 'number') return formatValue(price);
  const symbol = currency ? (CURRENCIES[currency] ?? currency) : '';
  return `${price}${symbol ? ` ${symbol}` : ''}`;
}

/** Whether the layout of this result has the place a conflict belongs to (the result may leave out its plan, row or add-on). */
function isDrawn(target: ConflictTarget, draft: PricingDraft): boolean {
  const plans = draft.plans ?? {};
  const rows: Record<RowSection, Record<string, unknown>> = {
    features: draft.features ?? {},
    usageLimits: draft.usageLimits ?? {},
  };
  switch (target.kind) {
    case 'section':
      return true;
    case 'plan':
      return target.plan in plans;
    case 'cell':
      return target.plan in plans && target.name in rows[target.section];
    case 'row':
      return target.name in rows[target.section];
    case 'addOn':
      return target.addOn in (draft.addOns ?? {});
    case 'other':
      return false;
  }
}

/**
 * The conflicts of each place of the layout. What the layout does not draw
 * gets a row of its own under "Other fields", so every conflict shows once.
 */
function placeConflicts(conflicts: readonly MergeConflict[], draft: PricingDraft): Map<string, MergeConflict[]> {
  const places = new Map<string, MergeConflict[]>();
  for (const [place, group] of groupConflictsByTarget(conflicts)) {
    if (isDrawn(conflictTarget(group[0].path), draft)) places.set(place, group);
    else for (const conflict of group) places.set(JSON.stringify(['other', conflict.id]), [conflict]);
  }
  return places;
}

/**
 * The Visual view: the result laid out like the visual editor (plans against
 * features and usage limits, then the add-ons), read-only. Every place with a
 * conflict is marked "Conflict"; picking a mark shows its conflicts with their
 * choices, which are the same choices as in the other views. What the layout
 * does not draw is listed under "Other fields", as text.
 */
export default function VisualConflicts({
  resolver,
  currentLabel,
  onShowYaml,
}: {
  resolver: MergeResolver;
  currentLabel: string;
  onShowYaml: () => void;
}) {
  const { state, resultYaml } = resolver;
  const parsed = useMemo(() => parseResult(resultYaml), [resultYaml]);
  const [selected, setSelected] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  const places = useMemo(
    () => (parsed.ok ? placeConflicts(state.conflicts, parsed.draft) : new Map<string, MergeConflict[]>()),
    [parsed, state.conflicts]
  );

  useEffect(() => {
    if (selected) panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  if (!parsed.ok) return <VisualEditorUnavailable message={parsed.message} onBackToCode={onShowYaml} />;

  const { draft, raw } = parsed;
  const planKeys = Object.keys(draft.plans ?? {});
  const featureKeys = orderFeaturesByGroup(draft);
  const groups = getFeatureGroups(draft);
  const limits = draft.usageLimits ?? {};
  const limitKeys = Object.keys(limits);
  const addOns = draft.addOns ?? {};
  const addOnKeys = Object.keys(addOns);
  const columns = planKeys.length + 1;

  const marker = (place: string) => {
    const conflicts = places.get(place);
    if (!conflicts) return null;
    const open = conflicts.filter(conflict => !state.choices[conflict.id]).length;
    const isSelected = selected === place;
    return (
      <button
        type="button"
        data-conflicts={conflicts.length}
        aria-pressed={isSelected}
        // Says which conflicts the mark stands for, not only that there is one.
        aria-label={`${conflicts.map(conflict => conflict.label).join(', ')}: ${open > 0 ? `${open} unresolved` : 'resolved'}`}
        onClick={() => {
          setSelected(isSelected ? null : place);
          resolver.focus(conflicts[0].id);
        }}
        className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
          open > 0
            ? 'border-tp-severity-warning-border bg-tp-severity-warning-bg text-tp-ink hover:border-tp-severity-warning'
            : 'border-tp-severity-success-border bg-tp-severity-success-bg text-tp-ink hover:border-tp-severity-success'
        } ${isSelected ? 'ring-2 ring-tp-primary/50' : ''}`}
      >
        {open > 0 ? (
          <FiAlertTriangle aria-hidden="true" className="h-3 w-3 text-tp-severity-warning" />
        ) : (
          <FiCheck aria-hidden="true" className="h-3 w-3 text-tp-severity-success" />
        )}
        {open === 0 ? 'Resolved' : conflicts.length === 1 ? 'Conflict' : `${conflicts.length} conflicts`}
      </button>
    );
  };

  const sectionMarker = (section: 'plans' | 'features' | 'usageLimits' | 'addOns') =>
    marker(targetKey({ kind: 'section', section }));

  const sectionRow = (title: string, section: RowSection) => (
    <tr className="bg-tp-surface">
      <th colSpan={columns} scope="colgroup" className="px-3 py-2 text-left">
        <span className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tp-slate">
          {title}
          {sectionMarker(section)}
        </span>
      </th>
    </tr>
  );

  const row = (section: RowSection, name: string, cell: (plan: string) => ReactNode) => (
    <tr key={`${section}:${name}`} className="border-t border-tp-hairline">
      <th
        scope="row"
        style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
        className="sticky left-0 z-10 bg-tp-canvas px-3 py-2 text-left font-medium text-tp-ink"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="break-all">{name}</span>
          {marker(targetKey({ kind: 'row', section, name }))}
        </span>
      </th>
      {planKeys.map(plan => (
        <td key={plan} className="px-3 py-2 text-center text-tp-charcoal">
          <span className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="break-all">{cell(plan)}</span>
            {marker(targetKey({ kind: 'cell', plan, section, name }))}
          </span>
        </td>
      ))}
    </tr>
  );

  const featureRow = (name: string) =>
    row('features', name, plan =>
      formatValue(draft.plans[plan]?.features?.[name]?.value ?? draft.features[name]?.defaultValue)
    );

  const others = [...places].filter(([place]) => JSON.parse(place)[0] === 'other');
  const selectedConflicts = selected ? places.get(selected) : undefined;

  return (
    <div className="space-y-5">
      <p className="text-xs text-tp-steel">
        The result, read-only. Places marked <strong className="font-semibold">Conflict</strong> need a choice: pick one
        to choose a side.
      </p>

      {selectedConflicts && (
        <section ref={panel} aria-label="Selected conflicts" className="space-y-2">
          {selectedConflicts.map(conflict => (
            <ConflictCard key={conflict.id} conflict={conflict} resolver={resolver} currentLabel={currentLabel} />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-tp-ink">Plans</h4>
          {sectionMarker('plans')}
        </div>
        <div className="overflow-x-auto rounded-xl border border-tp-hairline">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
                  className="sticky left-0 z-10 bg-tp-canvas px-3 py-2 text-left font-medium text-tp-steel"
                >
                  {draft.saasName}
                </th>
                {planKeys.map(plan => (
                  <th key={plan} scope="col" className="min-w-[140px] bg-tp-surface px-3 py-2 text-center align-top">
                    <span className="block break-all text-sm font-semibold uppercase tracking-wide text-tp-ink">
                      {plan}
                    </span>
                    <span className="mt-0.5 block font-normal text-tp-slate">
                      {formatPrice(draft.plans[plan]?.price, draft.currency)}
                      {draft.plans[plan]?.unit ? ` ${draft.plans[plan]?.unit}` : ''}
                    </span>
                    <span className="mt-1 flex justify-center">{marker(targetKey({ kind: 'plan', plan }))}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectionRow('Features', 'features')}
              {featureKeys.filter(name => !draft.features[name].tag).map(featureRow)}
              {groups.map(group => (
                <Fragment key={group}>
                  <tr className="border-t border-tp-hairline">
                    <th colSpan={columns} scope="colgroup" className="px-3 py-1.5 text-left text-xs font-medium text-tp-steel">
                      {group}
                    </th>
                  </tr>
                  {featureKeys.filter(name => draft.features[name].tag === group).map(featureRow)}
                </Fragment>
              ))}
              {(limitKeys.length > 0 || places.has(targetKey({ kind: 'section', section: 'usageLimits' }))) &&
                sectionRow('Usage limits', 'usageLimits')}
              {limitKeys.map(name =>
                row('usageLimits', name, plan => {
                  const value = draft.plans[plan]?.usageLimits?.[name]?.value ?? limits[name]?.defaultValue;
                  return typeof value === 'number' && limits[name]?.unit ? `${value} ${limits[name].unit}` : formatValue(value);
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {(addOnKeys.length > 0 || places.has(targetKey({ kind: 'section', section: 'addOns' }))) && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-tp-ink">Add-ons</h4>
            {sectionMarker('addOns')}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {addOnKeys.map(name => (
              <li key={name} className="space-y-1 rounded-xl border border-tp-hairline bg-tp-canvas p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="break-all text-sm font-semibold text-tp-ink">{name}</span>
                  {marker(targetKey({ kind: 'addOn', addOn: name }))}
                </div>
                <p className="text-tp-slate">
                  {formatPrice(addOns[name].price, draft.currency)}
                  {addOns[name].unit ? ` ${addOns[name].unit}` : ''}
                </p>
                {addOns[name].availableFor && addOns[name].availableFor.length > 0 && (
                  <p className="break-words text-tp-steel">Available for {addOns[name].availableFor.join(', ')}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-tp-ink">Other fields</h4>
          <ul className="space-y-2">
            {others.map(([place, conflicts]) => {
              const value = resultValueAt(raw, conflicts[0].path);
              return (
                <li key={place} className="space-y-1.5 rounded-xl border border-tp-hairline bg-tp-canvas p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all font-mono text-xs font-semibold text-tp-ink">{conflicts[0].label}</code>
                    {marker(place)}
                  </div>
                  {value === null ? (
                    <p className="text-xs italic text-tp-steel">Not in the result</p>
                  ) : (
                    <pre className="max-h-40 overflow-auto whitespace-pre rounded-lg bg-tp-surface px-2.5 py-2 font-mono text-xs text-tp-ink">
                      {value}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
