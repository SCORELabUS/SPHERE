import { applySelectionInput, createDefaultSelection } from 'pricing-renderer';
import type { NormalizedPricing, PricingSelection } from 'pricing-renderer';

import type { Configuration } from './index';

/**
 * A point in the configuration space is exactly `(selected_plan, selected_addons)` --
 * `PricingModel.mzn` decides nothing else, and the features, usage limits and cost the solver
 * reports are all derived from those two. A `PricingSelection` holds the same pair, so the two
 * sides of this tab are one configuration in two views, not two selections that happen to agree.
 */

/** The analysis counts add-ons 0/1, so a picked add-on is always exactly one. */
export const ANALYSIS_ADDON_QUANTITY = 1;

/** The add-ons a selection has turned on, sorted so two sets compare by value. */
export function selectedAddOnIds(selection: PricingSelection | undefined): string[] {
  if (!selection) return [];
  return Object.entries(selection.addOns ?? {})
    .filter(([, entry]) => entry?.selected)
    .map(([id]) => id)
    .sort();
}

/** Whether a selection is this configuration. */
export function sameAsConfiguration(
  configuration: Configuration,
  planId: string | undefined,
  addOnIds: string[]
): boolean {
  if ((configuration.selectedPlan ?? '') !== (planId ?? '')) return false;
  const configured = [...configuration.selectedAddons].sort();
  return configured.length === addOnIds.length && configured.every((id, i) => id === addOnIds[i]);
}

/**
 * The selection for a configuration.
 *
 * Every add-on the pricing defines is named, including the ones this configuration leaves off:
 * `applySelection` merges, so an add-on left out would silently keep whatever the previous
 * configuration set it to.
 */
export function selectionForConfiguration(
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

/**
 * A complete selection for a configuration, reconciled against the pricing.
 *
 * `selectionForConfiguration` returns only the plan and the add-ons, which is all `applySelection`
 * needs because it merges. Anything that stores or serializes a selection needs the whole thing --
 * `selectionToSearchParams` reads `variables`, and a partial passed as complete throws on it.
 */
export function completeSelectionForConfiguration(
  pricing: NormalizedPricing,
  configuration: Configuration,
  current?: PricingSelection
): PricingSelection {
  return applySelectionInput(
    pricing,
    current ?? createDefaultSelection(pricing),
    selectionForConfiguration(pricing, configuration)
  ).selection;
}

/** A short, readable name for a captured configuration: the plan, and how many add-ons with it. */
export function describeSelection(selection: PricingSelection): string {
  const plan = selection.planId || 'No plan';
  const count = selectedAddOnIds(selection).length;
  if (count === 0) return plan;
  return `${plan} + ${count} add-on${count === 1 ? '' : 's'}`;
}
