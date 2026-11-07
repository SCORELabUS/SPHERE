import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  resolvePricing,
  selectionFromSearchParams,
  selectionToSearchParams,
} from 'pricing-renderer';
import type { NormalizedPricing, PricingSelection, ResolvedPricing } from 'pricing-renderer';
import type {
  PricingReadyEvent,
  PricingRendererElement,
  PricingSelectionChangeEvent,
} from 'pricing-renderer/react';

import SpherePricingRenderer, {
  type SpherePricingSource,
} from '../../../core/components/pricing-renderer';
import ConfigurationComparison from './configuration-comparison';
import type { Configuration } from './index';

/**
 * Sections the picker does not draw.
 *
 * The page header above already carries the name and dates (`saasName`, `description`, `metadata`),
 * the Overview tab already has the full comparison, and the renderer's own summary total would sit
 * next to the one in the strip below saying the same thing.
 *
 * `billing` and `variables` are hidden for a different reason: the configuration space has no
 * notion of either. `PricingModel.mzn` decides only `selected_plan` and `selected_addons`, and the
 * DZN export resolves expressions to constants before the solver sees them. Left live, the renderer
 * would price a point the space cannot represent and "which configuration is this" would quietly
 * stop matching.
 */
const PICKER_HIDDEN_SECTIONS = [
  'saasName',
  'description',
  'metadata',
  'billing',
  'variables',
  'comparison',
  'summary',
] as const;

/** The analysis counts add-ons 0/1, so a picked add-on is always exactly one. */
const ANALYSIS_ADDON_QUANTITY = 1;

/** How many one-add-on-away configurations to offer. */
const NEIGHBOUR_LIMIT = 8;

/** Query-string prefixes, so both captured configurations share one URL. */
const SIDE_PREFIX = { a: 'cfgA.', b: 'cfgB.' } as const;

/** A short label for a captured configuration: the plan, and how many add-ons with it. */
function describeSelection(selection: PricingSelection): string {
  const plan = selection.planId || 'No plan';
  const count = selectedAddOnIds(selection).length;
  if (count === 0) return plan;
  return `${plan} + ${count} add-on${count === 1 ? '' : 's'}`;
}

/** Builds the selection for a configuration, naming every add-on so nothing is inherited. */
function selectionForConfiguration(
  pricing: NormalizedPricing,
  configuration: Configuration
): Partial<PricingSelection> {
  const wanted = new Set(configuration.selectedAddons);
  const addOns: PricingSelection['addOns'] = {};
  for (const addOn of pricing.addOns) {
    addOns[addOn.id] = { selected: wanted.has(addOn.id), quantity: ANALYSIS_ADDON_QUANTITY };
  }
  return { planId: configuration.selectedPlan, addOns };
}

function selectedAddOnIds(selection: PricingSelection | undefined): string[] {
  if (!selection) return [];
  return Object.entries(selection.addOns ?? {})
    .filter(([, entry]) => entry?.selected)
    .map(([id]) => id)
    .sort();
}

function sameAsConfiguration(
  configuration: Configuration,
  planId: string | undefined,
  addOnIds: string[]
): boolean {
  if ((configuration.selectedPlan ?? '') !== (planId ?? '')) return false;
  const configured = [...configuration.selectedAddons].sort();
  return configured.length === addOnIds.length && configured.every((id, i) => id === addOnIds[i]);
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    // A pricing may carry a currency code Intl does not know.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export interface ConfigurationPickerProps {
  /** The pricing document, as the card page resolved it. */
  source: SpherePricingSource;
  /** The configuration the explorer is on, if any. */
  focused?: Configuration & { id: string };
  /** Every configuration currently in view, after the search and plan filter. */
  configurations: Array<Configuration & { id: string }>;
  /** The whole space, so a configuration hidden by the filter is not called invalid. */
  allConfigurations: Array<Configuration & { id: string }>;
  /** Index of the focused configuration among `configurations`, 1-based; 0 when there is none. */
  position: number;
  /** Called when a selection made in the renderer lands on a different configuration. */
  onPick: (id: string) => void;
}

/**
 * The pricing itself, used as the way into the configuration space.
 *
 * A point in the space is exactly `(selected_plan, selected_addons)` — everything else the solver
 * reports is derived from those two — and that is precisely what a `PricingSelection` holds. So
 * picking a plan or an add-on here *is* moving through the space, and moving through the space with
 * Prev / Next / Surprise me / Quick Browse redraws the pricing. The two directions cannot loop: the
 * element's `applySelection` is silent by contract, and only a change the user makes raises
 * `pricing-selection-change`.
 *
 * A selection the solver never produced is left alone rather than snapped back, and the strip says
 * so. The renderer already stops most of those arising: it enforces add-on availability,
 * dependencies and exclusions as you click, which are constraints C6 to C8 of the same model.
 *
 * State comes from the element's own `onReady` / `onSelectionChange` props rather than
 * `usePricingRendererState`. That hook attaches in a layout effect and so can miss the first
 * `pricing-ready`, which is a documented limit of it; these props are wired when the element is
 * created, so they never miss it.
 */
export default function ConfigurationPicker({
  source,
  focused,
  configurations,
  allConfigurations,
  position,
  onPick,
}: ConfigurationPickerProps) {
  const ref = useRef<PricingRendererElement>(null);
  const [pricing, setPricing] = useState<NormalizedPricing>();
  const [selection, setSelection] = useState<PricingSelection>();
  const [resolved, setResolved] = useState<ResolvedPricing>();

  // The two configurations being compared, and the URL that makes the pair a link.
  const [sides, setSides] = useState<{ a?: PricingSelection; b?: PricingSelection }>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const restoredRef = useRef(false);

  // The configuration last written into the renderer, so neither direction re-applies its own work.
  const syncedRef = useRef<string | null>(null);

  const handleReady = useCallback((event: PricingReadyEvent) => {
    setPricing(event.detail.pricing);
    setSelection(event.detail.selection);
    setResolved(event.detail.resolved);
  }, []);

  const handleSelectionChange = useCallback((event: PricingSelectionChangeEvent) => {
    setSelection(event.detail.selection);
    setResolved(event.detail.resolved);
  }, []);

  const selectedIds = useMemo(() => selectedAddOnIds(selection), [selection]);

  const match = useMemo(
    () => configurations.find(c => sameAsConfiguration(c, selection?.planId, selectedIds)) ?? null,
    [configurations, selection?.planId, selectedIds]
  );

  // A configuration the search or the plan filter hides is still a real one: only a selection
  // missing from the whole space is something the analysis never produced.
  const inSpace = useMemo(
    () =>
      match !== null ||
      allConfigurations.some(c => sameAsConfiguration(c, selection?.planId, selectedIds)),
    [match, allConfigurations, selection?.planId, selectedIds]
  );

  // The configurations one add-on away from this one, priced. The solver reports no cost, so each
  // is resolved here from the document the renderer already parsed -- the same calculation the
  // renderer uses for its own totals, so the numbers agree.
  const neighbours = useMemo(() => {
    if (!pricing || !selection) return [];
    const current = new Set(selectedIds);
    const currentCost = resolved?.requiresQuote ? null : (resolved?.subtotal ?? null);
    const out: Array<{ id: string; addOnId: string; added: boolean; delta: number | null }> = [];
    for (const candidate of configurations) {
      if ((candidate.selectedPlan ?? '') !== (selection.planId ?? '')) continue;
      const other = new Set(candidate.selectedAddons);
      let differences = 0;
      let changed = '';
      for (const id of current) if (!other.has(id)) { differences += 1; changed = id; }
      for (const id of other) if (!current.has(id)) { differences += 1; changed = id; }
      if (differences !== 1) continue;
      const price = resolvePricing(pricing, selectionForConfiguration(pricing, candidate));
      out.push({
        id: candidate.id,
        addOnId: changed,
        added: other.has(changed),
        delta: price.requiresQuote || currentCost === null ? null : price.subtotal - currentCost,
      });
      if (out.length >= NEIGHBOUR_LIMIT) break;
    }
    return out.sort((a, b) => (a.delta ?? Infinity) - (b.delta ?? Infinity));
  }, [pricing, selection, selectedIds, configurations, resolved]);

  const capture = useCallback(
    (side: 'a' | 'b') => {
      if (!selection) return;
      setSides(prev => {
        const next = { ...prev, [side]: selection };
        const params = new URLSearchParams(searchParams);
        for (const key of [...params.keys()]) {
          if (key.startsWith(SIDE_PREFIX[side])) params.delete(key);
        }
        for (const [k, v] of selectionToSearchParams(selection, { prefix: SIDE_PREFIX[side] })) {
          params.append(k, v);
        }
        setSearchParams(params, { replace: true });
        return next;
      });
    },
    [selection, searchParams, setSearchParams]
  );

  const clearSides = useCallback(() => {
    setSides({});
    const params = new URLSearchParams(searchParams);
    for (const key of [...params.keys()]) {
      if (key.startsWith(SIDE_PREFIX.a) || key.startsWith(SIDE_PREFIX.b)) params.delete(key);
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  // A link someone was given: read both sides back once the pricing is known. Absent keys mean the
  // side was never captured -- selectionFromSearchParams would otherwise hand back the defaults.
  useEffect(() => {
    if (!pricing || restoredRef.current) return;
    restoredRef.current = true;
    const entries = [...searchParams.entries()];
    const restored: { a?: PricingSelection; b?: PricingSelection } = {};
    for (const side of ['a', 'b'] as const) {
      if (!entries.some(([key]) => key.startsWith(SIDE_PREFIX[side]))) continue;
      restored[side] = selectionFromSearchParams(pricing, entries, {
        prefix: SIDE_PREFIX[side],
      }).selection;
    }
    if (restored.a || restored.b) setSides(restored);
  }, [pricing, searchParams]);

  // The explorer moved: write that configuration into the renderer.
  useEffect(() => {
    if (!focused || !pricing) return;
    if (syncedRef.current === focused.id) return;
    const wanted = new Set(focused.selectedAddons);
    const addOns: PricingSelection['addOns'] = {};
    // Every add-on is named explicitly: applySelection merges, so one left out would keep whatever
    // the previous configuration set it to.
    for (const addOn of pricing.addOns) {
      addOns[addOn.id] = { selected: wanted.has(addOn.id), quantity: ANALYSIS_ADDON_QUANTITY };
    }
    const result = ref.current?.applySelection({ planId: focused.selectedPlan, addOns });
    syncedRef.current = focused.id;
    // applySelection raises no event, so the state it returns is the only report of the change.
    if (result?.applied) {
      setSelection(result.selection);
      setResolved(result.resolved);
    }
  }, [focused, pricing]);

  // The renderer moved: follow it, when it landed on a configuration the solver produced.
  useEffect(() => {
    if (!match || match.id === focused?.id) return;
    syncedRef.current = match.id;
    onPick(match.id);
  }, [match, focused?.id, onPick]);

  const currency = pricing?.metadata.currency ?? 'EUR';
  const inView = match !== null;
  const ready = pricing !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
          ready && !inSpace
            ? 'border-tp-severity-warning-border bg-tp-severity-warning-bg'
            : 'border-tp-hairline bg-tp-surface'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              !ready ? 'bg-tp-muted' : inSpace ? 'bg-tp-severity-success' : 'bg-tp-severity-warning'
            }`}
          />
          <p className="text-xs text-tp-slate">
            {!ready
              ? 'Reading the pricing…'
              : inView
                ? `In the configuration space · #${position} of ${configurations.length.toLocaleString()}`
                : inSpace
                  ? 'In the space, but hidden by the search or plan filter'
                  : 'Not a configuration the analysis produced'}
          </p>
        </div>
        {resolved && (
          <p className="text-xs text-tp-steel">
            <span className="font-medium text-tp-ink">
              {resolved.requiresQuote ? 'Quote' : formatMoney(resolved.subtotal, currency)}
            </span>
            {!resolved.requiresQuote && <span className="ml-1">at base prices</span>}
          </p>
        )}
      </div>

      <SpherePricingRenderer
        ref={ref}
        source={source}
        hideSections={PICKER_HIDDEN_SECTIONS}
        variablesEnabled={false}
        onReady={handleReady}
        onSelectionChange={handleSelectionChange}
      />

      {/* Capture two configurations and compare them. The renderer above is the only selection UI:
          "Set as A" / "Set as B" take whatever is on screen, so there is no second pricing table. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-tp-steel">Compare</p>
        <button
          type="button"
          disabled={!selection}
          onClick={() => capture('a')}
          className="cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1 text-xs text-tp-slate transition-colors hover:bg-tp-surface disabled:opacity-40"
        >
          Set as A
        </button>
        <button
          type="button"
          disabled={!selection}
          onClick={() => capture('b')}
          className="cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1 text-xs text-tp-slate transition-colors hover:bg-tp-surface disabled:opacity-40"
        >
          Set as B
        </button>
        {(['a', 'b'] as const).map(side =>
          sides[side] ? (
            <span
              key={side}
              className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[11px] text-tp-primary"
            >
              {side.toUpperCase()}: {describeSelection(sides[side]!)}
            </span>
          ) : null
        )}
        {(sides.a || sides.b) && (
          <button
            type="button"
            onClick={clearSides}
            className="ml-auto cursor-pointer text-[11px] text-tp-steel underline underline-offset-2 hover:text-tp-ink"
          >
            Clear
          </button>
        )}
      </div>

      {pricing && sides.a && sides.b && (
        <div className="rounded-lg border border-tp-hairline bg-tp-canvas p-3">
          <h3 className="mb-2 text-sm font-semibold text-tp-ink">A compared with B</h3>
          <ConfigurationComparison pricing={pricing} a={sides.a} b={sides.b} />
        </div>
      )}

      {neighbours.length > 0 && (
        <div className="rounded-lg border border-tp-hairline bg-tp-surface p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-tp-steel">
            One add-on away
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {neighbours.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => onPick(n.id)}
                className="cursor-pointer rounded-lg border border-tp-hairline bg-tp-canvas px-3 py-1.5 text-left transition-colors hover:bg-tp-surface"
              >
                <span className="text-xs text-tp-ink">
                  {n.added ? '+ ' : '− '}
                  {n.addOnId}
                </span>
                <span className="ml-2 text-[11px] text-tp-steel">
                  {n.delta === null
                    ? 'quote'
                    : `${n.delta >= 0 ? '+' : '−'}${formatMoney(Math.abs(n.delta), currency)}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
