import { LintContext, isNullish, isPlainObject } from '../context';
import type { LintRuleCode, NodePath } from '../types';
import { PRICE_VARIABLE_REGEXP } from './constants';
import type { FeatureSummary } from './features';
import type { UsageLimitSummary } from './usage-limits';
import { checkStringArray, checkValueAgainstValueType } from './shared';

export interface PricingIndex {
  features: Map<string, FeatureSummary>;
  usageLimits: Map<string, UsageLimitSummary>;
  planNames: Set<string>;
  addOnNames: Set<string>;
}

export type OverrideKind = 'feature' | 'usageLimit';

/**
 * Validates a `features` / `usageLimits` / `usageLimitsExtensions` override map
 * declared inside a plan or an add-on: every key must name a globally declared
 * element, and every override must carry a `value` of the declared valueType.
 */
export function checkValueOverrides(
  context: LintContext,
  overrides: unknown,
  path: NodePath,
  ownerLabel: string,
  kind: OverrideKind,
  index: PricingIndex
): void {
  if (isNullish(overrides)) {
    return;
  }

  if (!isPlainObject(overrides)) {
    context.error(
      'invalid-type',
      `${ownerLabel}: ${path[path.length - 1]} must be a map of overrides.`,
      path,
      'key'
    );

    return;
  }

  const declared = kind === 'feature' ? index.features : index.usageLimits;
  const code: LintRuleCode =
    kind === 'feature' ? 'unknown-feature-reference' : 'unknown-usage-limit-reference';
  const noun = kind === 'feature' ? 'feature' : 'usage limit';

  for (const [name, override] of Object.entries(overrides)) {
    const entryPath = [...path, name];
    const summary = declared.get(name);

    if (summary === undefined) {
      context.error(
        code,
        `${ownerLabel} overrides the ${noun} "${name}", which is not declared in the global ${kind === 'feature' ? 'features' : 'usageLimits'}.`,
        entryPath,
        'key'
      );

      continue;
    }

    if (isNullish(override)) {
      continue;
    }

    if (!isPlainObject(override)) {
      context.error(
        'invalid-type',
        `${ownerLabel}: the override for "${name}" must be a map containing a "value" field.`,
        entryPath,
        'key'
      );

      continue;
    }

    if (!('value' in override)) {
      context.error(
        'missing-required-field',
        `${ownerLabel}: the override for "${name}" must declare its new value through the "value" field.`,
        entryPath,
        'key'
      );

      continue;
    }

    checkValueAgainstValueType(
      context,
      override.value,
      summary.valueType,
      [...entryPath, 'value'],
      `${ownerLabel}: the value of "${name}"`,
      { isPaymentFeature: kind === 'feature' && (summary as FeatureSummary).isPaymentFeature }
    );
  }
}

/** `usageLimits.<name>.linkedFeatures` must point at declared features. */
export function checkLinkedFeatures(context: LintContext, index: PricingIndex): void {
  for (const [name, usageLimit] of Object.entries(context.mapAt('usageLimits'))) {
    if (!isPlainObject(usageLimit)) {
      continue;
    }

    const path: NodePath = ['usageLimits', name, 'linkedFeatures'];
    const linkedFeatures = checkStringArray(
      context,
      usageLimit.linkedFeatures,
      path,
      `The usage limit "${name}": linkedFeatures`
    );

    linkedFeatures?.forEach((featureName, position) => {
      if (!index.features.has(featureName)) {
        context.error(
          'unknown-feature-reference',
          `The usage limit "${name}" is linked to the feature "${featureName}", which is not declared in the global features.`,
          [...path, position]
        );
      }
    });
  }
}

/** Reports names in a list that are not declared elsewhere in the pricing. */
export function checkNameReferences(
  context: LintContext,
  names: string[] | undefined,
  declared: Set<string>,
  path: NodePath,
  code: LintRuleCode,
  describe: (name: string) => string
): void {
  names?.forEach((name, position) => {
    if (!declared.has(name)) {
      context.error(code, describe(name), [...path, position]);
    }
  });
}

/**
 * Prices may embed `#variableName` placeholders that are resolved against the
 * root `variables` map before evaluation; an undeclared one breaks evaluation.
 */
export function checkPriceVariables(
  context: LintContext,
  price: unknown,
  path: NodePath,
  label: string
): void {
  if (typeof price !== 'string') {
    return;
  }

  const declared = context.mapAt('variables');

  for (const match of price.matchAll(PRICE_VARIABLE_REGEXP)) {
    const variable = match[1];

    if (!(variable in declared)) {
      context.error(
        'unknown-variable-reference',
        `${label} references the variable "#${variable}", which is not declared in the root "variables" map.`,
        path
      );
    }
  }
}

/**
 * Elements that no plan or add-on ever references render with their default
 * value everywhere, which is usually an oversight rather than an intent.
 */
export function checkUnreferencedElements(context: LintContext, index: PricingIndex): void {
  const referencedFeatures = new Set<string>();
  const referencedUsageLimits = new Set<string>();

  const collect = (owner: unknown) => {
    if (!isPlainObject(owner)) {
      return;
    }

    for (const name of Object.keys(asMap(owner.features))) {
      referencedFeatures.add(name);
    }

    for (const name of Object.keys(asMap(owner.usageLimits))) {
      referencedUsageLimits.add(name);
    }

    for (const name of Object.keys(asMap(owner.usageLimitsExtensions))) {
      referencedUsageLimits.add(name);
    }
  };

  Object.values(context.mapAt('plans')).forEach(collect);
  Object.values(context.mapAt('addOns')).forEach(collect);

  for (const usageLimit of Object.values(context.mapAt('usageLimits'))) {
    if (!isPlainObject(usageLimit) || !Array.isArray(usageLimit.linkedFeatures)) {
      continue;
    }

    for (const featureName of usageLimit.linkedFeatures) {
      if (typeof featureName === 'string') {
        referencedFeatures.add(featureName);
      }
    }
  }

  for (const name of index.features.keys()) {
    if (!referencedFeatures.has(name)) {
      context.warn(
        'unused-feature',
        `The feature "${name}" is never referenced by a plan or an add-on, so every subscription resolves it to its defaultValue.`,
        ['features', name],
        'key'
      );
    }
  }

  for (const name of index.usageLimits.keys()) {
    if (!referencedUsageLimits.has(name)) {
      context.warn(
        'unused-usage-limit',
        `The usage limit "${name}" is never referenced by a plan or an add-on, so every subscription resolves it to its defaultValue.`,
        ['usageLimits', name],
        'key'
      );
    }
  }

  checkUnusedTags(context);
}

function checkUnusedTags(context: LintContext): void {
  const tags = context.pricing.tags;

  if (!Array.isArray(tags)) {
    return;
  }

  const usedTags = new Set(
    Object.values(context.mapAt('features'))
      .filter(isPlainObject)
      .map(feature => feature.tag)
      .filter((tag): tag is string => typeof tag === 'string')
  );

  tags.forEach((tag, position) => {
    if (typeof tag === 'string' && !usedTags.has(tag)) {
      context.warn(
        'unused-tag',
        `The tag "${tag}" is declared but no feature uses it.`,
        ['tags', position]
      );
    }
  });
}

function asMap(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}
