import { LintContext, describeType, isNullish, isPlainObject } from '../context';
import type { NodePath } from '../types';
import {
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  PAYMENT_TYPES,
  VALUE_TYPES,
  listOptions,
} from './constants';

export type ValueTypeName = (typeof VALUE_TYPES)[number];

/**
 * `pricing4ts` uppercases most enums before comparing, so the linter must accept
 * the same casing the parser accepts. Enums it compares strictly (integration and
 * automation types) go through {@link checkStrictEnum} instead.
 */
export function checkEnum(
  context: LintContext,
  value: unknown,
  options: readonly string[],
  path: NodePath,
  label: string
): string | undefined {
  if (isNullish(value)) {
    return undefined;
  }

  if (typeof value !== 'string') {
    context.error(
      'invalid-type',
      `${label} must be a string, one of: ${listOptions(options)}. Received ${describeType(value)}.`,
      path
    );

    return undefined;
  }

  const normalized = value.trim().toUpperCase();

  if (!options.includes(normalized)) {
    context.error(
      'invalid-enum-value',
      `${label} must be one of: ${listOptions(options)}. Received "${value}".`,
      path
    );

    return undefined;
  }

  return normalized;
}

export function checkStrictEnum(
  context: LintContext,
  value: unknown,
  options: readonly string[],
  path: NodePath,
  label: string
): string | undefined {
  if (isNullish(value)) {
    return undefined;
  }

  if (typeof value !== 'string' || !options.includes(value)) {
    context.error(
      'invalid-enum-value',
      `${label} must be exactly one of: ${listOptions(options)}. Received "${String(value)}".`,
      path
    );

    return undefined;
  }

  return value;
}

export function checkRequired(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): boolean {
  if (isNullish(value)) {
    context.error('missing-required-field', `${label} is required.`, path, 'key');

    return false;
  }

  return true;
}

export function checkString(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): string | undefined {
  if (isNullish(value)) {
    return undefined;
  }

  if (typeof value !== 'string') {
    context.error('invalid-type', `${label} must be a string.`, path);

    return undefined;
  }

  return value;
}

export function checkStringArray(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): string[] | undefined {
  if (isNullish(value)) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    context.error('invalid-type', `${label} must be a list of strings.`, path);

    return undefined;
  }

  const invalidIndex = value.findIndex(entry => typeof entry !== 'string');

  if (invalidIndex !== -1) {
    context.error('invalid-type', `${label} must only contain strings.`, [...path, invalidIndex]);

    return undefined;
  }

  return value as string[];
}

export function checkBoolean(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): void {
  if (isNullish(value) || typeof value === 'boolean') {
    return;
  }

  context.error('invalid-type', `${label} must be a boolean.`, path);
}

export function checkPositiveNumber(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): number | undefined {
  if (isNullish(value)) {
    return undefined;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    context.error('invalid-type', `${label} must be a number.`, path);

    return undefined;
  }

  if (value < 0) {
    context.error('invalid-value', `${label} must not be negative. Received ${value}.`, path);

    return undefined;
  }

  return value;
}

export function checkName(
  context: LintContext,
  name: string,
  path: NodePath,
  label: string
): void {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    context.error('invalid-name-length', `${label} must not be empty.`, path, 'key');

    return;
  }

  if (trimmed.length < MIN_NAME_LENGTH) {
    context.error(
      'invalid-name-length',
      `${label} must have at least ${MIN_NAME_LENGTH} characters. Received "${name}".`,
      path,
      'key'
    );

    return;
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    context.error(
      'invalid-name-length',
      `${label} must have at most ${MAX_NAME_LENGTH} characters.`,
      path,
      'key'
    );
  }
}

/**
 * Checks a `defaultValue` or a plan/add-on `value` override against the declared
 * `valueType`. `PAYMENT` features are the documented exception: their TEXT value
 * is a list of payment methods rather than a plain string.
 */
export function checkValueAgainstValueType(
  context: LintContext,
  value: unknown,
  valueType: ValueTypeName | undefined,
  path: NodePath,
  label: string,
  options: { isPaymentFeature?: boolean } = {}
): void {
  if (isNullish(value) || valueType === undefined) {
    return;
  }

  switch (valueType) {
    case 'NUMERIC':
      if (typeof value !== 'number') {
        context.error(
          'value-type-mismatch',
          `${label} must be a number because its valueType is NUMERIC. Received ${describeType(value)}.`,
          path
        );
      }
      break;

    case 'BOOLEAN':
      if (typeof value !== 'boolean') {
        context.error(
          'value-type-mismatch',
          `${label} must be a boolean because its valueType is BOOLEAN. Received ${describeType(value)}.`,
          path
        );
      }
      break;

    case 'TEXT':
      if (options.isPaymentFeature) {
        checkPaymentMethods(context, value, path, label);
        break;
      }

      if (typeof value !== 'string') {
        context.error(
          'value-type-mismatch',
          `${label} must be a string because its valueType is TEXT. Received ${describeType(value)}.`,
          path
        );
      }
      break;
  }
}

function checkPaymentMethods(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): void {
  if (!Array.isArray(value)) {
    context.error(
      'value-type-mismatch',
      `${label} must be a list of payment methods because the feature type is PAYMENT.`,
      path
    );

    return;
  }

  value.forEach((method, index) => {
    if (typeof method !== 'string' || !PAYMENT_TYPES.includes(method as never)) {
      context.error(
        'invalid-enum-value',
        `Invalid payment method "${String(method)}". Must be one of: ${listOptions(PAYMENT_TYPES)}.`,
        [...path, index]
      );
    }
  });
}

/** Reports and skips entries that should be maps but are not. */
export function expectMapEntry(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): value is Record<string, unknown> {
  if (isPlainObject(value)) {
    return true;
  }

  context.error('invalid-type', `${label} must be a map of fields.`, path, 'key');

  return false;
}
