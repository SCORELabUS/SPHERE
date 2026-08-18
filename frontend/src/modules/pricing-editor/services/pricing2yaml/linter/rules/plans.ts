import { LintContext, isNullish } from '../context';
import type { NodePath } from '../types';
import { checkPriceVariables, checkValueOverrides, type PricingIndex } from './references';
import { checkBoolean, checkName, checkString, expectMapEntry } from './shared';

export function checkPlans(context: LintContext, index: PricingIndex): void {
  const plans = context.pricing.plans;

  if (isNullish(plans)) {
    return;
  }

  if (!expectMapEntry(context, plans, ['plans'], 'plans')) {
    return;
  }

  for (const [name, plan] of Object.entries(plans)) {
    const path: NodePath = ['plans', name];

    checkName(context, name, path, `The plan name "${name}"`);

    if (!expectMapEntry(context, plan, path, `The plan "${name}"`)) {
      continue;
    }

    checkPlan(context, name, plan, path, index);
  }
}

function checkPlan(
  context: LintContext,
  name: string,
  plan: Record<string, unknown>,
  path: NodePath,
  index: PricingIndex
): void {
  const label = `The plan "${name}"`;

  checkPrice(context, plan.price, [...path, 'price'], path, label);
  checkString(context, plan.description, [...path, 'description'], `${label}: description`);
  checkString(context, plan.unit, [...path, 'unit'], `${label}: unit`);
  checkBoolean(context, plan.private, [...path, 'private'], `${label}: private`);

  if (isNullish(plan.unit)) {
    context.warn(
      'missing-required-field',
      `${label}: unit states what the price is charged per (for example "user/month") and should be provided.`,
      path,
      'key'
    );
  }

  checkValueOverrides(
    context,
    plan.features,
    [...path, 'features'],
    label,
    'feature',
    index
  );
  checkValueOverrides(
    context,
    plan.usageLimits,
    [...path, 'usageLimits'],
    label,
    'usageLimit',
    index
  );
}

/**
 * A price is either a number or a string holding an expression; both plans and
 * add-ons share these constraints.
 */
export function checkPrice(
  context: LintContext,
  price: unknown,
  path: NodePath,
  ownerPath: NodePath,
  label: string
): void {
  if (isNullish(price)) {
    context.error('missing-required-field', `${label}: price is required.`, ownerPath, 'key');

    return;
  }

  if (typeof price === 'number') {
    if (price < 0) {
      context.error(
        'invalid-value',
        `${label}: price must not be negative. Received ${price}.`,
        path
      );
    }

    return;
  }

  if (typeof price !== 'string') {
    context.error(
      'invalid-type',
      `${label}: price must be a number or a string containing an expression.`,
      path
    );

    return;
  }

  if (price.trim().length === 0) {
    context.error('invalid-value', `${label}: price must not be empty.`, path);

    return;
  }

  checkPriceVariables(context, price, path, `${label}: price`);
}
