import { LintContext, isNullish, isPlainObject } from '../context';
import type { NodePath } from '../types';
import { checkPrice } from './plans';
import { checkNameReferences, checkValueOverrides, type PricingIndex } from './references';
import {
  checkBoolean,
  checkPositiveNumber,
  checkName,
  checkString,
  checkStringArray,
  expectMapEntry,
} from './shared';

export function checkAddOns(context: LintContext, index: PricingIndex): void {
  const addOns = context.pricing.addOns;

  if (isNullish(addOns)) {
    return;
  }

  if (!expectMapEntry(context, addOns, ['addOns'], 'addOns')) {
    return;
  }

  for (const [name, addOn] of Object.entries(addOns)) {
    const path: NodePath = ['addOns', name];

    checkName(context, name, path, `The add-on name "${name}"`);

    if (!expectMapEntry(context, addOn, path, `The add-on "${name}"`)) {
      continue;
    }

    checkAddOn(context, name, addOn, path, index);
  }
}

function checkAddOn(
  context: LintContext,
  name: string,
  addOn: Record<string, unknown>,
  path: NodePath,
  index: PricingIndex
): void {
  const label = `The add-on "${name}"`;

  checkPrice(context, addOn.price, [...path, 'price'], path, label);
  checkString(context, addOn.description, [...path, 'description'], `${label}: description`);
  checkString(context, addOn.unit, [...path, 'unit'], `${label}: unit`);
  checkBoolean(context, addOn.private, [...path, 'private'], `${label}: private`);

  if (isNullish(addOn.unit)) {
    context.warn(
      'missing-required-field',
      `${label}: unit states what the price is charged per (for example "user/month") and should be provided.`,
      path,
      'key'
    );
  }

  checkAvailableFor(context, addOn, path, label, index);
  checkAddOnLinks(context, addOn, name, path, label, index);

  checkValueOverrides(context, addOn.features, [...path, 'features'], label, 'feature', index);
  checkValueOverrides(
    context,
    addOn.usageLimits,
    [...path, 'usageLimits'],
    label,
    'usageLimit',
    index
  );
  checkValueOverrides(
    context,
    addOn.usageLimitsExtensions,
    [...path, 'usageLimitsExtensions'],
    label,
    'usageLimit',
    index
  );

  checkNotEmpty(context, addOn, path, label);
  checkSubscriptionConstraints(context, addOn, path, label);
}

function checkAvailableFor(
  context: LintContext,
  addOn: Record<string, unknown>,
  path: NodePath,
  label: string,
  index: PricingIndex
): void {
  const fieldPath = [...path, 'availableFor'];
  const availableFor = checkStringArray(
    context,
    addOn.availableFor,
    fieldPath,
    `${label}: availableFor`
  );

  checkNameReferences(
    context,
    availableFor,
    index.planNames,
    fieldPath,
    'unknown-plan-reference',
    planName => `${label} is available for the plan "${planName}", which is not declared in "plans".`
  );
}

function checkAddOnLinks(
  context: LintContext,
  addOn: Record<string, unknown>,
  name: string,
  path: NodePath,
  label: string,
  index: PricingIndex
): void {
  for (const field of ['dependsOn', 'excludes'] as const) {
    const fieldPath = [...path, field];
    const names = checkStringArray(context, addOn[field], fieldPath, `${label}: ${field}`);

    checkNameReferences(
      context,
      names,
      index.addOnNames,
      fieldPath,
      'unknown-addon-reference',
      referenced =>
        `${label} declares "${referenced}" in ${field}, but that add-on is not declared in "addOns".`
    );

    names?.forEach((referenced, position) => {
      if (referenced === name) {
        context.error(
          'self-reference',
          `${label} cannot reference itself in ${field}.`,
          [...fieldPath, position]
        );
      }
    });
  }

  const dependsOn = Array.isArray(addOn.dependsOn) ? addOn.dependsOn : [];
  const excludes = Array.isArray(addOn.excludes) ? addOn.excludes : [];
  const conflicting = dependsOn.filter(entry => excludes.includes(entry));

  for (const entry of conflicting) {
    context.error(
      'invalid-value',
      `${label} both depends on and excludes "${String(entry)}", which can never be satisfied.`,
      [...path, 'excludes'],
      'key'
    );
  }
}

/** An add-on that changes nothing cannot be subscribed to in a meaningful way. */
function checkNotEmpty(
  context: LintContext,
  addOn: Record<string, unknown>,
  path: NodePath,
  label: string
): void {
  const isDefined = (value: unknown) => isPlainObject(value) && Object.keys(value).length > 0;

  if (
    !isDefined(addOn.features) &&
    !isDefined(addOn.usageLimits) &&
    !isDefined(addOn.usageLimitsExtensions)
  ) {
    context.error(
      'empty-addon',
      `${label} must provide at least one feature, usage limit or usage limit extension.`,
      path,
      'key'
    );
  }
}

/**
 * `subscriptionConstraints` only applies to scalable add-ons: those that extend
 * usage limits without adding features or overriding limits outright.
 */
function checkSubscriptionConstraints(
  context: LintContext,
  addOn: Record<string, unknown>,
  path: NodePath,
  label: string
): void {
  const fieldPath = [...path, 'subscriptionConstraints'];
  const constraints = addOn.subscriptionConstraints;

  if (isNullish(constraints)) {
    return;
  }

  if (!isPlainObject(constraints)) {
    context.error(
      'invalid-type',
      `${label}: subscriptionConstraints must be a map with minQuantity, maxQuantity and quantityStep.`,
      fieldPath,
      'key'
    );

    return;
  }

  const hasContents = (value: unknown) => isPlainObject(value) && Object.keys(value).length > 0;
  const isScalable =
    !hasContents(addOn.features) &&
    !hasContents(addOn.usageLimits) &&
    hasContents(addOn.usageLimitsExtensions);

  if (!isScalable) {
    context.warn(
      'invalid-subscription-constraints',
      `${label}: subscriptionConstraints only applies to scalable add-ons, which extend usage limits without declaring features or usage limit overrides. It will be ignored.`,
      fieldPath,
      'key'
    );
  }

  const minQuantity = checkPositiveNumber(
    context,
    constraints.minQuantity,
    [...fieldPath, 'minQuantity'],
    `${label}: minQuantity`
  );
  const maxQuantity = checkPositiveNumber(
    context,
    constraints.maxQuantity,
    [...fieldPath, 'maxQuantity'],
    `${label}: maxQuantity`
  );
  const quantityStep = checkPositiveNumber(
    context,
    constraints.quantityStep,
    [...fieldPath, 'quantityStep'],
    `${label}: quantityStep`
  );

  const effectiveMin = minQuantity ?? 1;

  if (maxQuantity !== undefined && maxQuantity < effectiveMin) {
    context.error(
      'invalid-subscription-constraints',
      `${label}: maxQuantity must be greater than or equal to minQuantity (${effectiveMin}). Received ${maxQuantity}.`,
      [...fieldPath, 'maxQuantity']
    );
  }

  if (quantityStep !== undefined && quantityStep > 0 && effectiveMin % quantityStep !== 0) {
    context.error(
      'invalid-subscription-constraints',
      `${label}: quantityStep must divide minQuantity (${effectiveMin}). Received ${quantityStep}.`,
      [...fieldPath, 'quantityStep']
    );
  }
}
