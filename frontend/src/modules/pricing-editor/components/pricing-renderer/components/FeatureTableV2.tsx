import { AnimatePresence, motion } from 'framer-motion';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import { FaChevronDown } from 'react-icons/fa6';
import { AddOn, Feature, Plan, UsageLimit } from 'pricing4ts';
import { camelToTitle } from '../shared/stringUtils';
import { formatMoneyDisplay, formatUsageDisplay } from '../shared/value-helpers';
import { useState } from 'react';
import PALETTE from '../shared/planPalette';

interface FeatureTableV2Props {
  plans: Record<string, Plan>;
  features: Record<string, Feature>;
  usageLimits: Record<string, UsageLimit> | undefined;
  addOns: Record<string, AddOn> | undefined;
  currency?: string | undefined;
}

type Row = { id: string; type: 'feature' | 'usageLimit'; key: string };

function getRenderFlagFrom(obj?: unknown): string {
  if (!obj) return 'AUTO';
  const renderValue = (obj as Record<string, unknown>)['render'];
  if (typeof renderValue === 'string' || typeof renderValue === 'number' || typeof renderValue === 'boolean') {
    return String(renderValue).toUpperCase();
  }
  return 'AUTO';
}

function hasNonEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['value', 'amount', 'quantity', 'defaultValue', 'max', 'limit', 'count']) {
      if (typeof obj[key] === 'number') return obj[key] !== 0;
      if (typeof obj[key] === 'string') return (obj[key] as string).trim() !== '';
    }
  }
  return true;
}

export function FeatureTableV2({ plans, features, usageLimits, addOns, currency }: Readonly<FeatureTableV2Props>) {
  const planKeys = Object.keys(plans);
  const featureKeys = Object.keys(features);
  const addOnKeys = Object.keys(addOns ?? {});

  const renderFlagOfFeature = (feature?: Feature) => getRenderFlagFrom(feature);
  const renderFlagOfUsage = (limit?: UsageLimit) => getRenderFlagFrom(limit);

  const usageByFeature: Record<string, string[]> = {};
  for (const usageKey of Object.keys(usageLimits ?? {})) {
    const usage = usageLimits?.[usageKey];
    if (!usage) continue;

    for (const featureKey of usage.linkedFeatures ?? []) {
      usageByFeature[featureKey] = usageByFeature[featureKey] ?? [];
      if (!usageByFeature[featureKey].includes(usageKey)) {
        usageByFeature[featureKey].push(usageKey);
      }
    }
  }

  const usageShouldRender: Record<string, boolean> = {};
  for (const usageKey of Object.keys(usageLimits ?? {})) {
    const usage = usageLimits?.[usageKey];
    if (!usage) continue;

    const usageRender = renderFlagOfUsage(usage);
    if (usageRender === 'DISABLED') {
      usageShouldRender[usageKey] = false;
      continue;
    }

    if (usageRender === 'ENABLED') {
      usageShouldRender[usageKey] = true;
      continue;
    }

    const globalLinked = usage.linkedFeatures ?? [];
    const multiLinked = globalLinked.length > 1;

    let anyNonDisabled = false;
    let hasAmbiguousFeature = false;
    let allLinkedAuto = true;

    for (const featureKey of globalLinked) {
      const featureRender = renderFlagOfFeature(features[featureKey]);
      if (featureRender !== 'DISABLED') anyNonDisabled = true;
      if ((usageByFeature[featureKey] ?? []).length > 1) hasAmbiguousFeature = true;
      if (featureRender !== 'AUTO') allLinkedAuto = false;
    }

    if (multiLinked) {
      usageShouldRender[usageKey] = anyNonDisabled;
    } else {
      usageShouldRender[usageKey] = anyNonDisabled && (hasAmbiguousFeature || (globalLinked.length > 1 && allLinkedAuto));
    }
  }

  function isAddOnAvailableForPlan(addOnKey: string, planKey: string, seen = new Set<string>()): boolean {
    if (!addOns) return false;
    if (seen.has(addOnKey)) return false;

    seen.add(addOnKey);
    const addOn = addOns[addOnKey];
    if (!addOn) return false;

    if (addOn.availableFor && addOn.availableFor.length > 0 && !addOn.availableFor.includes(planKey)) {
      return false;
    }

    if (!addOn.dependsOn || addOn.dependsOn.length === 0) {
      return true;
    }

    return addOn.dependsOn.every(depName => {
      const depKey = Object.keys(addOns).find(key => key === depName || addOns[key].name === depName);
      if (!depKey) return false;
      return isAddOnAvailableForPlan(depKey, planKey, new Set(seen));
    });
  }

  function buildRowsForFeatures(featureKeysToUse: string[]): Row[] {
    const rows: Row[] = [];
    const usageByFeatureLocal: Record<string, string[]> = {};

    for (const usageKey of Object.keys(usageLimits ?? {})) {
      const usage = usageLimits?.[usageKey];
      if (!usage) continue;

      for (const featureKey of usage.linkedFeatures ?? []) {
        if (!featureKeysToUse.includes(featureKey)) continue;

        usageByFeatureLocal[featureKey] = usageByFeatureLocal[featureKey] ?? [];
        if (!usageByFeatureLocal[featureKey].includes(usageKey)) {
          usageByFeatureLocal[featureKey].push(usageKey);
        }
      }
    }

    const usageShouldRenderLocal: Record<string, boolean> = {};
    for (const usageKey of Object.keys(usageLimits ?? {})) {
      const usage = usageLimits?.[usageKey];
      if (!usage) continue;

      const usageRender = renderFlagOfUsage(usage);
      if (usageRender === 'DISABLED') {
        usageShouldRenderLocal[usageKey] = false;
        continue;
      }

      if (usageRender === 'ENABLED') {
        usageShouldRenderLocal[usageKey] = true;
        continue;
      }

      const globalLinked = usage.linkedFeatures ?? [];
      const localLinked = globalLinked.filter(featureKey => featureKeysToUse.includes(featureKey));
      const isMultiLinked = globalLinked.length > 1;

      let anyNonDisabled = false;
      let hasAmbiguousFeature = false;
      let allLinkedAuto = true;

      for (const featureKey of localLinked) {
        const featureRender = renderFlagOfFeature(features[featureKey]);
        if (featureRender !== 'DISABLED') anyNonDisabled = true;
        if ((usageByFeature[featureKey] ?? []).length > 1) hasAmbiguousFeature = true;
        if (featureRender !== 'AUTO') allLinkedAuto = false;
      }

      if (isMultiLinked) {
        usageShouldRenderLocal[usageKey] = localLinked.length > 0 && anyNonDisabled;
      } else {
        usageShouldRenderLocal[usageKey] = anyNonDisabled && (hasAmbiguousFeature || (localLinked.length > 1 && allLinkedAuto));
      }
    }

    const renderedUsage = new Set<string>();

    for (const featureKey of featureKeysToUse) {
      const featureRender = renderFlagOfFeature(features[featureKey]);
      if (featureRender !== 'DISABLED') {
        rows.push({ id: `feature:${featureKey}`, type: 'feature', key: featureKey });
      }

      for (const usageKey of usageByFeatureLocal[featureKey] ?? []) {
        if (renderedUsage.has(usageKey)) continue;

        const usage = usageLimits?.[usageKey];
        if (!usage) continue;

        const usageRender = renderFlagOfUsage(usage);
        if (usageRender === 'DISABLED') continue;

        const globalLinked = usage.linkedFeatures ?? [];
        const linkedFeatures = globalLinked.filter(key => featureKeysToUse.includes(key));
        const anyNonDisabled = linkedFeatures.some(key => renderFlagOfFeature(features[key]) !== 'DISABLED');
        const hasMultiple = linkedFeatures.some(key => (usageByFeature[key] ?? []).length > 1);
        const allAuto = linkedFeatures.length > 0 && linkedFeatures.every(key => renderFlagOfFeature(features[key]) === 'AUTO');
        const multiLinkedGlobal = globalLinked.length > 1;

        const shouldRender = usageRender === 'ENABLED' ||
          featureRender === 'ENABLED' ||
          (usageRender === 'AUTO' && anyNonDisabled && featureRender !== 'DISABLED' && (multiLinkedGlobal || hasMultiple || (linkedFeatures.length > 1 && allAuto)));

        if (shouldRender) {
          rows.push({ id: `usage:${usageKey}`, type: 'usageLimit', key: usageKey });
          renderedUsage.add(usageKey);
        }
      }
    }

    for (const usageKey of Object.keys(usageLimits ?? {})) {
      if (renderedUsage.has(usageKey)) continue;
      if (!usageShouldRenderLocal[usageKey]) continue;

      rows.push({ id: `usage:${usageKey}`, type: 'usageLimit', key: usageKey });
      renderedUsage.add(usageKey);
    }

    return rows;
  }

  const tagToFeatureKeys: Record<string, string[]> = {};
  const untaggedFeatureKeys: string[] = [];

  for (const featureKey of featureKeys) {
    const feature = features[featureKey] as Feature & { tag?: string };
    const tag = typeof feature.tag === 'string' ? feature.tag.trim() : '';

    if (tag) {
      tagToFeatureKeys[tag] = tagToFeatureKeys[tag] ?? [];
      tagToFeatureKeys[tag].push(featureKey);
    } else {
      untaggedFeatureKeys.push(featureKey);
    }
  }

  const sortedTags = Object.keys(tagToFeatureKeys).sort((a, b) => a.localeCompare(b));
  const [openTags, setOpenTags] = useState<Record<string, boolean>>({});

  function isTagOpen(tag: string, index: number): boolean {
    const local = openTags[tag];
    if (typeof local === 'boolean') return local;
    return index === 0;
  }

  function toggleTag(tag: string, index: number) {
    setOpenTags(prev => ({
      ...prev,
      [tag]: !isTagOpen(tag, index),
    }));
  }

  // ── Cell rendering helpers (shared by table and mobile card views) ──

  function renderFeatureCell(featureKey: string, planKey: string): React.ReactNode {
    const feature = features[featureKey];
    const featureRender = renderFlagOfFeature(feature);
    const plan = plans[planKey];

    const featureValues = plan.features as Record<string, unknown> | undefined;
    const featureRaw = featureValues ? featureValues[featureKey] : undefined;

    let rawValue: unknown = undefined;
    if (featureRaw) {
      const featureRecord = featureRaw as Record<string, unknown>;
      rawValue = typeof featureRecord['value'] !== 'undefined' ? featureRecord['value'] : featureRecord['defaultValue'];
    }

    const providedByAddOn = addOnKeys.some(addOnKey => {
      const addOn = addOns?.[addOnKey];
      if (!addOn || !addOn.features?.[featureKey]) return false;
      return isAddOnAvailableForPlan(addOnKey, planKey);
    });

    const linkedUsageKeys = usageByFeature[featureKey] ?? [];
    const singleUsageKey = linkedUsageKeys.length === 1 ? linkedUsageKeys[0] : undefined;
    const showInlineUsage = typeof singleUsageKey !== 'undefined' &&
      renderFlagOfUsage(usageLimits?.[singleUsageKey]) === 'AUTO' &&
      featureRender === 'AUTO' &&
      !usageShouldRender[singleUsageKey];

    if (showInlineUsage) {
      const usage = usageLimits?.[singleUsageKey as string];
      const usageName = usage?.name ?? singleUsageKey;
      const planUsage = plan.usageLimits
        ? (plan.usageLimits as Record<string, UsageLimit>)[usageName].value
        : undefined;
      const effectiveUsage = hasNonEmptyValue(planUsage) ? planUsage : usage?.defaultValue;

      if (hasNonEmptyValue(effectiveUsage)) {
        return (
          <span className="inline-flex items-center justify-center rounded-lg bg-tp-primary px-4 py-1.5 text-sm font-bold leading-none text-tp-on-primary">
            {formatUsageDisplay(effectiveUsage, usage)}
          </span>
        );
      }
    }

    if (typeof rawValue === 'boolean' && rawValue) {
      return <FaCheckCircle className="mx-auto text-lg text-tp-primary" />;
    }

    if (typeof rawValue === 'string' || typeof rawValue === 'number') {
      if (typeof rawValue === 'number' && rawValue === 0) {
        return <FaTimesCircle className="mx-auto text-lg text-tp-muted" />;
      }
      return (
        <span className="text-sm font-semibold uppercase tracking-wide text-tp-charcoal">{String(rawValue)}</span>
      );
    }

    if (providedByAddOn) {
      return <span className="text-sm font-semibold text-tp-steel">Add-on</span>;
    }

    return <FaTimesCircle className="mx-auto text-lg text-tp-muted" />;
  }

  function renderUsageCell(usageKey: string, planKey: string): React.ReactNode {
    const usage = usageLimits?.[usageKey];
    const plan = plans[planKey];

    const valueFromPlan = plan.usageLimits?.[usage?.name ?? ''];
    const effectiveUsage = hasNonEmptyValue(valueFromPlan) ? valueFromPlan : usage?.defaultValue;

    if (hasNonEmptyValue(effectiveUsage)) {
      return (
        <span className="inline-flex items-center justify-center rounded-full bg-tp-primary px-4 py-1.5 text-sm font-bold leading-none text-tp-on-primary">
          {formatUsageDisplay(effectiveUsage, usage)}
        </span>
      );
    }

    return <FaTimesCircle className="mx-auto text-lg text-tp-muted" />;
  }

  // ── Table rendering (desktop) ──

  function renderTable(featureBucket: string[]) {
    const rows = buildRowsForFeatures(featureBucket);

    return (
      <table className="w-full min-w-150">
        <thead>
          <tr>
            <th className="px-4 py-2 text-left" />
            {planKeys.map((planKey, index) => {
              const plan = plans[planKey];
              
              if (plan.private === true) return(<></>);

              const planName = plan.name ?? camelToTitle(planKey);
              const [a, b] = PALETTE[index % PALETTE.length];

              return (
                <th key={planKey} className="align-top">
                  <div
                    className="flex h-31 flex-col items-center justify-center text-center text-tp-on-primary shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
                  >
                    <p className="text-xl font-bold tracking-wide sm:text-2xl">{String(planName).toUpperCase()}</p>
                    <p className="text-lg font-semibold sm:text-xl">
                      {plan.price === 0
                        ? 'FREE'
                        : `${formatMoneyDisplay(plan.price)}${typeof plan.price === 'number' ? (currency ?? '') : ''}`}
                    </p>
                    {typeof plan.unit === 'string' && (
                      <p className="text-sm opacity-90">{plan.unit}</p>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <motion.tbody layout>
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((row, rowIndex) => {
            if (row.type === 'feature') {
              const featureKey = row.key;
              const feature = features[featureKey];

              return (
                <motion.tr
                  key={row.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ delay: 0.04 * rowIndex, duration: 0.35 }}
                >
                  <th scope="row" className="p-[16px] text-left text-sm font-bold leading-tight text-tp-charcoal sm:text-base">
                    {camelToTitle(feature.name) ?? camelToTitle(featureKey)}
                  </th>

                  {planKeys.map(planKey => {
                    const plan = plans[planKey];
                    if (plan.private === true) return(<></>);

                    return (
                      <td key={planKey} className="py-5 text-center align-middle">
                        {renderFeatureCell(featureKey, planKey)}
                      </td>
                    );
                  })}
                </motion.tr>
              );
            }

            const usageKey = row.key;
            const usage = usageLimits?.[usageKey];

            return (
              <motion.tr
                key={row.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: 0.04 * rowIndex, duration: 0.18 }}
              >
                <th scope="row" className="px-4 py-5 text-left text-sm font-bold leading-tight text-tp-charcoal sm:text-base">
                  {camelToTitle(usage?.name ?? usageKey)}
                </th>

                {planKeys.map(planKey => {
                  const plan = plans[planKey];
                  if (plan.private === true) return(<></>);

                  return (
                    <td key={planKey} className="py-5 text-center align-middle">
                      {renderUsageCell(usageKey, planKey)}
                    </td>
                  );
                })}
              </motion.tr>
            );
          })}
          </AnimatePresence>
        </motion.tbody>
      </table>
    );
  }

  // ── Mobile card rendering ──

  function renderMobilePlanCard(planKey: string, index: number) {
    const plan = plans[planKey];
    if (plan.private === true) return null;

    const planName = plan.name ?? camelToTitle(planKey);
    const [a, b] = PALETTE[index % PALETTE.length];
    const rows = buildRowsForFeatures([...untaggedFeatureKeys, ...sortedTags.flatMap(t => tagToFeatureKeys[t])]);

    const featureRows = rows.filter(r => r.type === 'feature');
    const usageRows = rows.filter(r => r.type === 'usageLimit');

    return (
      <div key={planKey} className="overflow-hidden rounded-xl border border-tp-hairline-soft bg-tp-canvas shadow-elevation-1">
        <div
          className="flex flex-col items-center justify-center px-4 py-6 text-center text-tp-on-primary"
          style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
        >
          <p className="text-xl font-bold tracking-wide">{String(planName).toUpperCase()}</p>
          <p className="mt-1 text-lg font-semibold">
            {plan.price === 0
              ? 'FREE'
              : `${formatMoneyDisplay(plan.price)}${typeof plan.price === 'number' ? (currency ?? '') : ''}`}
          </p>
          {typeof plan.unit === 'string' && (
            <p className="text-sm opacity-90">{plan.unit}</p>
          )}
        </div>

        <div className="divide-y divide-tp-hairline-soft">
          {featureRows.map(row => (
            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 text-sm font-bold text-tp-charcoal">
                {camelToTitle(features[row.key].name) ?? camelToTitle(row.key)}
              </span>
              <span className="flex shrink-0 items-center justify-center">
                {renderFeatureCell(row.key, planKey)}
              </span>
            </div>
          ))}
          {usageRows.map(row => (
            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 text-sm font-bold text-tp-charcoal">
                {camelToTitle(usageLimits?.[row.key]?.name ?? row.key)}
              </span>
              <span className="flex shrink-0 items-center justify-center">
                {renderUsageCell(row.key, planKey)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderMobileCards() {
    const publicPlanKeys = planKeys.filter(k => plans[k].private !== true);

    return (
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {publicPlanKeys.map((planKey, index) => renderMobilePlanCard(planKey, index))}
      </div>
    );
  }

  // ── Main render ──

  return (
    <div className="mt-8 w-full">
      {/* Desktop: table view */}
      <div className="hidden overflow-x-auto md:block">
        {renderTable(untaggedFeatureKeys)}

        {sortedTags.map((tag, index) => {
          const open = isTagOpen(tag, index);
          const tagPanelId = `tag-panel-${tag.replace(/\s+/g, '-').toLowerCase()}`;

          return (
            <div key={tag} className="mt-5 overflow-hidden rounded-xl border border-tp-hairline-soft bg-tp-canvas shadow-elevation-1">
              <button
                type="button"
                onClick={() => toggleTag(tag, index)}
                className="flex w-full cursor-pointer items-center justify-between bg-tp-surface px-5 py-4 text-left text-base font-semibold text-tp-ink transition-colors hover:bg-tp-hairline-soft"
                aria-expanded={open}
                aria-controls={tagPanelId}
              >
                <span>{tag}</span>
                <motion.span
                  initial={false}
                  animate={{ rotate: open ? 180 : 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="inline-flex text-tp-steel"
                  aria-hidden
                >
                  <FaChevronDown className="h-4 w-4" />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    id={tagPanelId}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="overflow-x-auto border-t border-tp-hairline px-1 pb-3 pt-2">{renderTable(tagToFeatureKeys[tag])}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Mobile: card view */}
      <div className="block md:hidden">
        {renderMobileCards()}

        {sortedTags.map((tag, index) => {
          const open = isTagOpen(tag, index);
          const tagPanelId = `mobile-tag-panel-${tag.replace(/\s+/g, '-').toLowerCase()}`;

          return (
            <div key={tag} className="mt-5 overflow-hidden rounded-xl border border-tp-hairline-soft bg-tp-canvas shadow-elevation-1">
              <button
                type="button"
                onClick={() => toggleTag(tag, index)}
                className="flex w-full cursor-pointer items-center justify-between bg-tp-surface px-5 py-4 text-left text-base font-semibold text-tp-ink transition-colors hover:bg-tp-hairline-soft"
                aria-expanded={open}
                aria-controls={tagPanelId}
              >
                <span>{tag}</span>
                <motion.span
                  initial={false}
                  animate={{ rotate: open ? 180 : 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="inline-flex text-tp-steel"
                  aria-hidden
                >
                  <FaChevronDown className="h-4 w-4" />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    id={tagPanelId}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-tp-hairline p-3">
                      <div className="grid grid-cols-1 gap-3">
                        {planKeys
                          .filter(k => plans[k].private !== true)
                          .map((planKey, pi) => renderMobilePlanCard(planKey, pi))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FeatureTableV2;
