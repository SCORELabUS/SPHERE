import { LintContext, isNullish, isPlainObject } from '../context';
import type { NodePath } from '../types';
import { PERIOD_UNITS, RENDER_MODES, USAGE_LIMIT_TYPES, VALUE_TYPES } from './constants';
import {
  checkBoolean,
  checkEnum,
  checkName,
  checkRequired,
  checkString,
  checkValueAgainstValueType,
  expectMapEntry,
  type ValueTypeName,
} from './shared';

/** Declared usage limit metadata that later rules need, keyed by limit name. */
export interface UsageLimitSummary {
  valueType?: ValueTypeName;
}

export function checkUsageLimits(context: LintContext): Map<string, UsageLimitSummary> {
  const summaries = new Map<string, UsageLimitSummary>();
  const usageLimits = context.pricing.usageLimits;

  if (isNullish(usageLimits)) {
    return summaries;
  }

  if (!expectMapEntry(context, usageLimits, ['usageLimits'], 'usageLimits')) {
    return summaries;
  }

  for (const [name, usageLimit] of Object.entries(usageLimits)) {
    const path: NodePath = ['usageLimits', name];

    checkName(context, name, path, `The usage limit name "${name}"`);

    if (!expectMapEntry(context, usageLimit, path, `The usage limit "${name}"`)) {
      summaries.set(name, {});

      continue;
    }

    summaries.set(name, checkUsageLimit(context, name, usageLimit, path));
  }

  return summaries;
}

function checkUsageLimit(
  context: LintContext,
  name: string,
  usageLimit: Record<string, unknown>,
  path: NodePath
): UsageLimitSummary {
  const label = `The usage limit "${name}"`;

  checkRequired(context, usageLimit.type, [...path, 'type'], `${label}: type`);
  const type = checkEnum(
    context,
    usageLimit.type,
    USAGE_LIMIT_TYPES,
    [...path, 'type'],
    `${label}: type`
  );

  checkRequired(context, usageLimit.valueType, [...path, 'valueType'], `${label}: valueType`);
  const valueType = checkEnum(
    context,
    usageLimit.valueType,
    VALUE_TYPES,
    [...path, 'valueType'],
    `${label}: valueType`
  ) as ValueTypeName | undefined;

  checkRequired(
    context,
    usageLimit.defaultValue,
    [...path, 'defaultValue'],
    `${label}: defaultValue`
  );
  checkValueAgainstValueType(
    context,
    usageLimit.defaultValue,
    valueType,
    [...path, 'defaultValue'],
    `${label}: defaultValue`
  );

  checkString(context, usageLimit.description, [...path, 'description'], `${label}: description`);
  checkString(context, usageLimit.unit, [...path, 'unit'], `${label}: unit`);
  checkEnum(context, usageLimit.render, RENDER_MODES, [...path, 'render'], `${label}: render`);

  if (isNullish(usageLimit.unit)) {
    context.warn(
      'missing-required-field',
      `${label}: unit describes what the limit measures (for example "GB" or "calls/month") and should be provided.`,
      path,
      'key'
    );
  }

  checkRenewalFields(context, usageLimit, type, path, label);

  return { valueType };
}

/**
 * `RENEWABLE` limits reset every period, `NON_RENEWABLE` ones are consumed once
 * and only need tracking. A limit that declares neither cannot be evaluated.
 */
function checkRenewalFields(
  context: LintContext,
  usageLimit: Record<string, unknown>,
  type: string | undefined,
  path: NodePath,
  label: string
): void {
  const hasPeriod = !isNullish(usageLimit.period);
  const hasTrackable = !isNullish(usageLimit.trackable);

  if (type === 'RENEWABLE' && !hasPeriod) {
    context.error(
      'missing-conditional-field',
      `${label}: period is required when type is RENEWABLE.`,
      path,
      'key'
    );
  }

  if (type === 'NON_RENEWABLE' && !hasTrackable) {
    context.error(
      'missing-conditional-field',
      `${label}: trackable is required when type is NON_RENEWABLE.`,
      path,
      'key'
    );
  }

  if (!hasPeriod && !hasTrackable) {
    context.error(
      'missing-conditional-field',
      `${label} must define either a period or a trackable flag.`,
      path,
      'key'
    );
  }

  if (hasTrackable) {
    checkBoolean(context, usageLimit.trackable, [...path, 'trackable'], `${label}: trackable`);
  }

  if (hasPeriod) {
    checkPeriod(context, usageLimit.period, [...path, 'period'], label);
  }
}

function checkPeriod(
  context: LintContext,
  period: unknown,
  path: NodePath,
  label: string
): void {
  if (!isPlainObject(period)) {
    context.error(
      'invalid-type',
      `${label}: period must be a map with "value" and "unit" fields.`,
      path,
      'key'
    );

    return;
  }

  checkEnum(context, period.unit, PERIOD_UNITS, [...path, 'unit'], `${label}: period.unit`);

  if (isNullish(period.value)) {
    return;
  }

  if (typeof period.value !== 'number' || Number.isNaN(period.value)) {
    context.error('invalid-type', `${label}: period.value must be a number.`, [...path, 'value']);

    return;
  }

  if (period.value <= 0) {
    context.error(
      'invalid-value',
      `${label}: period.value must be greater than 0. Received ${period.value}.`,
      [...path, 'value']
    );
  }
}
