import { LintContext, isNullish } from '../context';
import type { NodePath } from '../types';
import {
  AUTOMATION_TYPES,
  FEATURE_TYPES,
  INTEGRATION_TYPES,
  RENDER_MODES,
  VALUE_TYPES,
  listOptions,
} from './constants';
import {
  checkEnum,
  checkName,
  checkRequired,
  checkStrictEnum,
  checkString,
  checkStringArray,
  checkValueAgainstValueType,
  expectMapEntry,
  type ValueTypeName,
} from './shared';

const URL_PATTERN = /^(https?):\/\/[^\s/$.?#].[^\s]*$/i;

/** Declared feature metadata that later rules need, keyed by feature name. */
export interface FeatureSummary {
  valueType?: ValueTypeName;
  isPaymentFeature: boolean;
}

export function checkFeatures(context: LintContext): Map<string, FeatureSummary> {
  const summaries = new Map<string, FeatureSummary>();
  const features = context.pricing.features;

  if (isNullish(features)) {
    return summaries;
  }

  if (!expectMapEntry(context, features, ['features'], 'features')) {
    return summaries;
  }

  const tags = Array.isArray(context.pricing.tags) ? context.pricing.tags : [];

  for (const [name, feature] of Object.entries(features)) {
    const path: NodePath = ['features', name];

    checkName(context, name, path, `The feature name "${name}"`);

    if (!expectMapEntry(context, feature, path, `The feature "${name}"`)) {
      summaries.set(name, { isPaymentFeature: false });

      continue;
    }

    summaries.set(name, checkFeature(context, name, feature, path, tags));
  }

  return summaries;
}

function checkFeature(
  context: LintContext,
  name: string,
  feature: Record<string, unknown>,
  path: NodePath,
  tags: unknown[]
): FeatureSummary {
  const label = `The feature "${name}"`;

  checkRequired(context, feature.type, [...path, 'type'], `${label}: type`);
  const type = checkEnum(context, feature.type, FEATURE_TYPES, [...path, 'type'], `${label}: type`);

  checkRequired(context, feature.valueType, [...path, 'valueType'], `${label}: valueType`);
  const valueType = checkEnum(
    context,
    feature.valueType,
    VALUE_TYPES,
    [...path, 'valueType'],
    `${label}: valueType`
  ) as ValueTypeName | undefined;

  const isPaymentFeature = type === 'PAYMENT';

  checkRequired(context, feature.defaultValue, [...path, 'defaultValue'], `${label}: defaultValue`);
  checkValueAgainstValueType(
    context,
    feature.defaultValue,
    valueType,
    [...path, 'defaultValue'],
    `${label}: defaultValue`,
    { isPaymentFeature }
  );

  checkString(context, feature.description, [...path, 'description'], `${label}: description`);
  checkExpression(context, feature.expression, [...path, 'expression'], `${label}: expression`);
  checkExpression(
    context,
    feature.serverExpression,
    [...path, 'serverExpression'],
    `${label}: serverExpression`
  );
  checkEnum(context, feature.render, RENDER_MODES, [...path, 'render'], `${label}: render`);

  const integrationType = checkIntegrationType(context, feature, type, path, label);
  checkAutomationType(context, feature, type, path, label);
  checkPricingUrls(context, feature, type, integrationType, path, label);
  checkDocUrl(context, feature, type, path, label);
  checkTag(context, feature, tags, path, label);

  return { valueType, isPaymentFeature };
}

function checkExpression(
  context: LintContext,
  value: unknown,
  path: NodePath,
  label: string
): void {
  const expression = checkString(context, value, path, label);

  if (expression !== undefined && expression.trim().length === 0) {
    context.error(
      'invalid-value',
      `${label} must not be empty. Remove the field instead of leaving it blank.`,
      path
    );
  }
}

function checkIntegrationType(
  context: LintContext,
  feature: Record<string, unknown>,
  type: string | undefined,
  path: NodePath,
  label: string
): string | undefined {
  if (isNullish(feature.integrationType)) {
    if (type === 'INTEGRATION') {
      context.error(
        'missing-conditional-field',
        `${label}: integrationType is required when type is INTEGRATION. Expected one of: ${listOptions(INTEGRATION_TYPES)}.`,
        path,
        'key'
      );
    }

    return undefined;
  }

  return checkStrictEnum(
    context,
    feature.integrationType,
    INTEGRATION_TYPES,
    [...path, 'integrationType'],
    `${label}: integrationType`
  );
}

function checkAutomationType(
  context: LintContext,
  feature: Record<string, unknown>,
  type: string | undefined,
  path: NodePath,
  label: string
): void {
  if (isNullish(feature.automationType)) {
    if (type === 'AUTOMATION') {
      context.error(
        'missing-conditional-field',
        `${label}: automationType is required when type is AUTOMATION. Expected one of: ${listOptions(AUTOMATION_TYPES)}.`,
        path,
        'key'
      );
    }

    return;
  }

  checkStrictEnum(
    context,
    feature.automationType,
    AUTOMATION_TYPES,
    [...path, 'automationType'],
    `${label}: automationType`
  );
}

function checkPricingUrls(
  context: LintContext,
  feature: Record<string, unknown>,
  type: string | undefined,
  integrationType: string | undefined,
  path: NodePath,
  label: string
): void {
  const fieldPath = [...path, 'pricingUrls'];
  const urls = checkStringArray(context, feature.pricingUrls, fieldPath, `${label}: pricingUrls`);

  if (urls === undefined) {
    return;
  }

  urls.forEach((url, index) => {
    if (!URL_PATTERN.test(url)) {
      context.error(
        'invalid-value',
        `${label}: pricingUrls must contain valid http or https URLs. Received "${url}".`,
        [...fieldPath, index]
      );
    }
  });

  if (type !== 'INTEGRATION' || integrationType !== 'WEB_SAAS') {
    context.warn(
      'invalid-value',
      `${label}: pricingUrls only applies to features with type INTEGRATION and integrationType WEB_SAAS, so it will be ignored.`,
      fieldPath,
      'key'
    );
  }
}

function checkDocUrl(
  context: LintContext,
  feature: Record<string, unknown>,
  type: string | undefined,
  path: NodePath,
  label: string
): void {
  const fieldPath = [...path, 'docUrl'];

  if (isNullish(feature.docUrl)) {
    if (type === 'GUARANTEE') {
      context.warn(
        'missing-conditional-field',
        `${label}: features of type GUARANTEE should provide a docUrl pointing to the compliance documentation.`,
        path,
        'key'
      );
    }

    return;
  }

  const docUrl = checkString(context, feature.docUrl, fieldPath, `${label}: docUrl`);

  if (docUrl !== undefined && !URL_PATTERN.test(docUrl)) {
    context.error(
      'invalid-value',
      `${label}: docUrl must be a valid http or https URL. Received "${docUrl}".`,
      fieldPath
    );

    return;
  }

  if (type !== 'GUARANTEE') {
    context.warn(
      'invalid-value',
      `${label}: docUrl only applies to features with type GUARANTEE, so it will be ignored.`,
      fieldPath,
      'key'
    );
  }
}

function checkTag(
  context: LintContext,
  feature: Record<string, unknown>,
  tags: unknown[],
  path: NodePath,
  label: string
): void {
  const fieldPath = [...path, 'tag'];
  const tag = checkString(context, feature.tag, fieldPath, `${label}: tag`);

  if (tag === undefined) {
    return;
  }

  if (!tags.includes(tag)) {
    context.error(
      'unknown-tag-reference',
      `${label}: tag "${tag}" is not declared in the root "tags" list.`,
      fieldPath
    );
  }
}
