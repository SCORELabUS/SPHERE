import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NormalizedPricing, PricingSelection, ResolvedPricing } from 'pricing-renderer';
import type {
  PricingReadyEvent,
  PricingRendererElement,
  PricingSelectionChangeEvent,
} from 'pricing-renderer/react';

import SpherePricingRenderer, {
  type SpherePricingSource,
} from '../../../core/components/pricing-renderer';
import type { Configuration } from './index';
import {
  sameAsConfiguration,
  selectedAddOnIds,
  selectionForConfiguration,
} from './selection-mapping';

/**
 * Sections the picker does not draw.
 *
 * The page header above already carries the name and dates (`saasName`, `description`, `metadata`),
 * the Overview tab already has the full comparison, and the renderer's own summary total would sit
 * next to the one in the strip saying the same thing.
 *
 * `billing` and `variables` are hidden for a different reason: the configuration space has no
 * notion of either. `PricingModel.mzn` decides only `selected_plan` and `selected_addons`, and the
 * DZN export resolves expressions to constants before the solver sees them. Left live, the renderer
 * would price a point the space cannot represent and the readout would quietly stop matching.
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
  /** The configuration the tab is on, if any. */
  focused?: Configuration & { id: string };
  /** Every configuration currently in view, after the search and plan filter. */
  configurations: Array<Configuration & { id: string }>;
  /** The whole space, so a configuration hidden by the filter is not called invalid. */
  allConfigurations: Array<Configuration & { id: string }>;
  /** Index of the focused configuration among `configurations`, 1-based; 0 when there is none. */
  position: number;
  /** Called when a selection made here lands on a different configuration. */
  onPick: (id: string) => void;
  /** Lifts the renderer's state so the tab can build selections and hold them for comparison. */
  onStateChange: (state: { pricing: NormalizedPricing; selection: PricingSelection }) => void;
  /** Label for the capture action, which names the act rather than the slot. */
  captureLabel: string;
  /** Holds the selection currently on screen for comparison. */
  onCapture: () => void;
}

/**
 * The pricing, used as the way into the configuration space.
 *
 * This and the readout above it are one configuration in two views: choosing a row in Quick Browse
 * draws it here, and picking a plan or an add-on here moves the readout. The two cannot loop: the
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
  onStateChange,
  captureLabel,
  onCapture,
}: ConfigurationPickerProps) {
  const ref = useRef<PricingRendererElement>(null);
  const [pricing, setPricing] = useState<NormalizedPricing>();
  const [selection, setSelection] = useState<PricingSelection>();
  const [resolved, setResolved] = useState<ResolvedPricing>();

  // The configuration last written into the renderer, so neither view re-applies the other's work.
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

  useEffect(() => {
    if (pricing && selection) onStateChange({ pricing, selection });
  }, [pricing, selection, onStateChange]);

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

  // The readout moved: write that configuration into the renderer.
  useEffect(() => {
    if (!focused || !pricing) return;
    if (syncedRef.current === focused.id) return;
    const result = ref.current?.applySelection(selectionForConfiguration(pricing, focused));
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
                ? `Configuration ${position} of ${configurations.length.toLocaleString()}`
                : inSpace
                  ? 'In the space, but hidden by the search or plan filter'
                  : 'Not a configuration the analysis produced'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {resolved && (
            <p className="text-xs text-tp-steel">
              <span className="font-medium text-tp-ink">
                {resolved.requiresQuote ? 'Quote' : formatMoney(resolved.subtotal, currency)}
              </span>
              {!resolved.requiresQuote && <span className="ml-1">at base prices</span>}
            </p>
          )}
          <button
            type="button"
            disabled={!selection}
            onClick={onCapture}
            className="cursor-pointer whitespace-nowrap rounded-md bg-tp-primary px-2.5 py-1 text-xs font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:opacity-40"
          >
            {captureLabel}
          </button>
        </div>
      </div>

      <SpherePricingRenderer
        ref={ref}
        source={source}
        hideSections={PICKER_HIDDEN_SECTIONS}
        variablesEnabled={false}
        onReady={handleReady}
        onSelectionChange={handleSelectionChange}
      />
    </div>
  );
}
