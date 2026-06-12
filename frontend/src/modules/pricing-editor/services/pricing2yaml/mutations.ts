import type { PricingDraft } from './types';

export function updateField(d: PricingDraft, path: string, value: unknown): PricingDraft {
  const result = structuredClone(d);
  const parts = path.split('.');
  let obj: any = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (obj[key] === undefined || obj[key] === null) {
      obj[key] = {};
    }
    obj = obj[key];
  }
  obj[parts[parts.length - 1]] = value;
  return result;
}

export function addPlan(d: PricingDraft, newKey: string, afterKey?: string): PricingDraft {
  const result = structuredClone(d);
  const featureNames = Object.keys(result.features);
  const newPlan: PricingDraft['plans'][string] = {
    description: '',
    price: 0,
    unit: result.plans && Object.values(result.plans).length > 0
      ? Object.values(result.plans)[0].unit ?? 'user/month'
      : 'user/month',
    features: featureNames.length > 0 ? {} : null,
    usageLimits: null,
  };
  if (afterKey && result.plans[afterKey]) {
    const entries = Object.entries(result.plans);
    const idx = entries.findIndex(([k]) => k === afterKey);
    entries.splice(idx + 1, 0, [newKey, newPlan]);
    result.plans = Object.fromEntries(entries);
  } else {
    result.plans = { ...result.plans, [newKey]: newPlan };
  }
  return result;
}

export function removePlan(d: PricingDraft, planKey: string): PricingDraft {
  const result = structuredClone(d);
  delete result.plans[planKey];
  if (result.addOns) {
    for (const ao of Object.values(result.addOns)) {
      if (ao.availableFor) ao.availableFor = ao.availableFor.filter(p => p !== planKey);
    }
  }
  return result;
}

export function renamePlan(d: PricingDraft, oldKey: string, newKey: string): PricingDraft {
  if (oldKey === newKey) return d;
  const result = structuredClone(d);
  const plan = result.plans[oldKey];
  delete result.plans[oldKey];
  result.plans = { ...result.plans, [newKey]: plan };
  if (result.addOns) {
    for (const ao of Object.values(result.addOns)) {
      if (ao.availableFor) ao.availableFor = ao.availableFor.map(p => p === oldKey ? newKey : p);
    }
  }
  return result;
}

export function toggleFeatureValue(
  d: PricingDraft,
  planKey: string,
  featureKey: string
): PricingDraft {
  const result = structuredClone(d);
  const globalFeature = result.features[featureKey];
  if (!globalFeature || globalFeature.valueType !== 'BOOLEAN') return result;

  let currentVal: boolean;
  const planOverride = result.plans[planKey]?.features?.[featureKey];
  if (planOverride) {
    currentVal = planOverride.value as boolean;
  } else {
    currentVal = globalFeature.defaultValue as boolean;
  }

  const newVal = !currentVal;

  if (result.plans[planKey]) {
    if (!result.plans[planKey].features) {
      result.plans[planKey].features = {};
    }
    result.plans[planKey].features![featureKey] = { value: newVal };
  }

  return result;
}

export function setCellValue(
  d: PricingDraft,
  planKey: string,
  cellType: 'feature' | 'usageLimit',
  cellKey: string,
  value: string | number | boolean
): PricingDraft {
  const result = structuredClone(d);
  const plan = result.plans[planKey];
  if (!plan) return result;

  const container = cellType === 'feature' ? plan.features : plan.usageLimits;
  if (container && container[cellKey]) {
    container[cellKey].value = value;
  } else {
    if (cellType === 'feature') {
      if (!plan.features) plan.features = {};
      plan.features[cellKey] = { value };
    } else {
      if (!plan.usageLimits) plan.usageLimits = {};
      plan.usageLimits[cellKey] = { value };
    }
  }

  return result;
}

export function updatePlanProps(
  d: PricingDraft,
  planKey: string,
  updates: Partial<{ description: string; price: number | string; unit: string; private: boolean }>
): PricingDraft {
  const result = structuredClone(d);
  if (!result.plans[planKey]) return result;
  Object.assign(result.plans[planKey], updates);
  return result;
}

export function updateRenderMode(
  d: PricingDraft,
  entityType: 'feature' | 'usageLimit',
  entityKey: string,
  renderMode: 'auto' | 'enabled' | 'disabled'
): PricingDraft {
  const result = structuredClone(d);
  const collection = entityType === 'feature' ? result.features : result.usageLimits;
  if (collection && collection[entityKey]) {
    collection[entityKey].render = renderMode;
  }
  return result;
}

export function addFeature(d: PricingDraft, newKey: string): PricingDraft {
  const result = structuredClone(d);
  result.features[newKey] = {
    description: '',
    valueType: 'BOOLEAN',
    defaultValue: false,
    type: 'DOMAIN',
  };
  for (const plan of Object.values(result.plans)) {
    if (plan.features !== null && plan.features !== undefined) {
      plan.features[newKey] = { value: false };
    }
  }
  return result;
}

export function removeFeature(d: PricingDraft, featureKey: string): PricingDraft {
  const result = structuredClone(d);
  delete result.features[featureKey];
  for (const plan of Object.values(result.plans)) {
    if (plan.features) delete plan.features[featureKey];
  }
  if (result.usageLimits) {
    for (const ul of Object.values(result.usageLimits)) {
      if (ul.linkedFeatures) {
        ul.linkedFeatures = ul.linkedFeatures.filter(f => f !== featureKey);
      }
    }
  }
  return result;
}

export function addUsageLimit(d: PricingDraft, newKey: string): PricingDraft {
  const result = structuredClone(d);
  if (!result.usageLimits) result.usageLimits = {};
  result.usageLimits[newKey] = {
    description: '',
    valueType: 'NUMERIC',
    defaultValue: 0,
    unit: 'unit',
    type: 'RENEWABLE',
    linkedFeatures: [],
  };
  for (const plan of Object.values(result.plans)) {
    if (plan.usageLimits !== null && plan.usageLimits !== undefined) {
      plan.usageLimits[newKey] = { value: 0 };
    }
  }
  return result;
}

export function removeUsageLimit(d: PricingDraft, limitKey: string): PricingDraft {
  const result = structuredClone(d);
  if (result.usageLimits) delete result.usageLimits[limitKey];
  for (const plan of Object.values(result.plans)) {
    if (plan.usageLimits) delete plan.usageLimits[limitKey];
  }
  return result;
}

/* ── Add-on mutations ── */

export function addAddOn(d: PricingDraft, newKey: string): PricingDraft {
  const result = structuredClone(d);
  if (!result.addOns) result.addOns = {};
  const unit = result.plans && Object.values(result.plans).length > 0
    ? Object.values(result.plans)[0].unit ?? 'user/month'
    : 'user/month';
  result.addOns[newKey] = {
    description: '',
    price: 0,
    unit,
    availableFor: Object.keys(result.plans),
    subscriptionConstraints: { min: 1, max: 1, step: 1 },
  };
  return result;
}

export function removeAddOn(d: PricingDraft, addOnKey: string): PricingDraft {
  const result = structuredClone(d);
  if (result.addOns) {
    delete result.addOns[addOnKey];
    for (const ao of Object.values(result.addOns)) {
      if (ao.dependsOn) ao.dependsOn = ao.dependsOn.filter(d => d !== addOnKey);
      if (ao.excludes) ao.excludes = ao.excludes.filter(e => e !== addOnKey);
    }
  }
  return result;
}

export function renameAddOn(d: PricingDraft, oldKey: string, newKey: string): PricingDraft {
  if (oldKey === newKey) return d;
  const result = structuredClone(d);
  if (!result.addOns?.[oldKey]) return result;
  if (result.addOns[newKey]) return result;
  const addOn = result.addOns[oldKey];
  delete result.addOns[oldKey];
  result.addOns = { ...result.addOns, [newKey]: addOn };
  for (const ao of Object.values(result.addOns)) {
    if (ao.dependsOn) ao.dependsOn = ao.dependsOn.map(d => d === oldKey ? newKey : d);
    if (ao.excludes) ao.excludes = ao.excludes.map(e => e === oldKey ? newKey : e);
  }
  return result;
}

export function updateAddOnProps(
  d: PricingDraft,
  addOnKey: string,
  updates: Partial<import('./types').DraftAddOn>
): PricingDraft {
  const result = structuredClone(d);
  if (!result.addOns?.[addOnKey]) return result;
  Object.assign(result.addOns[addOnKey], updates);
  return result;
}

export function toggleAddOnAvailableFor(
  d: PricingDraft,
  addOnKey: string,
  planKey: string
): PricingDraft {
  const result = structuredClone(d);
  const ao = result.addOns?.[addOnKey];
  if (!ao) return result;
  if (!ao.availableFor) ao.availableFor = Object.keys(result.plans);
  const idx = ao.availableFor.indexOf(planKey);
  if (idx >= 0) {
    ao.availableFor.splice(idx, 1);
  } else {
    ao.availableFor.push(planKey);
  }
  return result;
}

export function setAddOnCellValue(
  d: PricingDraft,
  addOnKey: string,
  cellType: 'feature' | 'usageLimit' | 'usageLimitsExtension',
  cellKey: string,
  value: string | number | boolean
): PricingDraft {
  const result = structuredClone(d);
  const ao = result.addOns?.[addOnKey];
  if (!ao) return result;

  let container: Record<string, { value: string | number | boolean }> | undefined;
  if (cellType === 'feature') {
    if (!ao.features) ao.features = {};
    container = ao.features;
  } else if (cellType === 'usageLimit') {
    if (!ao.usageLimits) ao.usageLimits = {};
    container = ao.usageLimits;
  } else {
    if (!ao.usageLimitsExtensions) ao.usageLimitsExtensions = {};
    container = ao.usageLimitsExtensions;
  }

  if (container[cellKey]) {
    container[cellKey].value = value;
  } else {
    container[cellKey] = { value };
  }

  return result;
}
