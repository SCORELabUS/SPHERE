import { LintContext, describeType, isNullish, isPlainObject } from '../context';
import {
  ISO_4217_CODES,
  SUPPORTED_SYNTAX_VERSIONS,
  VERSION_REGEXP,
  listOptions,
} from './constants';
import { checkName, checkRequired, checkString, checkStringArray } from './shared';

const URL_PATTERN = /^(https?):\/\/[^\s/$.?#].[^\s]*$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validates the pricing header: identity, versioning, currency and billing. */
export function checkRootFields(context: LintContext): void {
  checkSyntaxVersion(context);
  checkSaasName(context);
  checkCreatedAt(context);
  checkCurrency(context);
  checkUrl(context);
  checkVersion(context);
  checkTags(context);
  checkBilling(context);
  checkVariables(context);
  checkAtLeastOneOffering(context);
}

function checkSyntaxVersion(context: LintContext): void {
  const value = context.pricing.syntaxVersion;

  if (!checkRequired(context, value, ['syntaxVersion'], 'syntaxVersion')) {
    return;
  }

  if (typeof value !== 'string' || !VERSION_REGEXP.test(value)) {
    context.error(
      'invalid-type',
      'syntaxVersion must be a string with the format X.Y, quoted so YAML does not read it as a number.',
      ['syntaxVersion']
    );

    return;
  }

  if (!SUPPORTED_SYNTAX_VERSIONS.includes(value as never)) {
    context.error(
      'unsupported-syntax-version',
      `Only syntax versions ${listOptions(SUPPORTED_SYNTAX_VERSIONS)} are supported by this editor. Received "${value}".`,
      ['syntaxVersion']
    );
  }
}

function checkSaasName(context: LintContext): void {
  const value = context.pricing.saasName;

  if (!checkRequired(context, value, ['saasName'], 'saasName')) {
    return;
  }

  if (typeof value !== 'string') {
    context.error('invalid-type', 'saasName must be a string.', ['saasName']);

    return;
  }

  checkName(context, value, ['saasName'], 'saasName');
}

function checkCreatedAt(context: LintContext): void {
  const value = context.pricing.createdAt;

  if (!checkRequired(context, value, ['createdAt'], 'createdAt')) {
    return;
  }

  let date: Date | undefined;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' && DATE_PATTERN.test(value)) {
    date = new Date(value);
  } else {
    context.error(
      'invalid-type',
      `createdAt must be a date in the format yyyy-mm-dd. Received ${describeType(value)}.`,
      ['createdAt']
    );

    return;
  }

  if (Number.isNaN(date.getTime())) {
    context.error('invalid-value', 'createdAt is not a valid date.', ['createdAt']);

    return;
  }

  if (date.getTime() > Date.now()) {
    context.error('invalid-value', 'createdAt must not be a future date.', ['createdAt']);
  }
}

function checkCurrency(context: LintContext): void {
  const value = context.pricing.currency;

  if (!checkRequired(context, value, ['currency'], 'currency')) {
    return;
  }

  if (typeof value !== 'string') {
    context.error('invalid-type', 'currency must be a string.', ['currency']);

    return;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    context.error('invalid-value', 'currency must not be empty.', ['currency']);

    return;
  }

  if (!ISO_4217_CODES.has(trimmed.toUpperCase())) {
    context.error(
      'invalid-value',
      `"${trimmed}" is not a valid ISO 4217 currency code.`,
      ['currency']
    );
  }
}

function checkUrl(context: LintContext): void {
  const value = checkString(context, context.pricing.url, ['url'], 'url');

  if (value !== undefined && !URL_PATTERN.test(value)) {
    context.error('invalid-value', 'url must be a valid http or https URL.', ['url']);
  }
}

function checkVersion(context: LintContext): void {
  checkString(context, context.pricing.version, ['version'], 'version');
}

function checkTags(context: LintContext): void {
  checkStringArray(context, context.pricing.tags, ['tags'], 'tags');
}

function checkBilling(context: LintContext): void {
  const billing = context.pricing.billing;

  if (isNullish(billing)) {
    return;
  }

  if (!isPlainObject(billing)) {
    context.error('invalid-type', 'billing must be a map of period names to numbers.', ['billing']);

    return;
  }

  for (const [period, ratio] of Object.entries(billing)) {
    const path = ['billing', period];

    if (typeof ratio !== 'number' || Number.isNaN(ratio)) {
      context.error('invalid-type', `The billing entry "${period}" must be a number.`, path);

      continue;
    }

    if (ratio <= 0 || ratio > 1) {
      context.error(
        'invalid-value',
        `The billing entry "${period}" must be in the range (0, 1]. Received ${ratio}.`,
        path
      );
    }
  }
}

function checkVariables(context: LintContext): void {
  const variables = context.pricing.variables;

  if (!isNullish(variables) && !isPlainObject(variables)) {
    context.error('invalid-type', 'variables must be a map of names to values.', ['variables']);
  }
}

function checkAtLeastOneOffering(context: LintContext): void {
  const hasPlans = Object.keys(context.mapAt('plans')).length > 0;
  const hasAddOns = Object.keys(context.mapAt('addOns')).length > 0;

  if (!hasPlans && !hasAddOns) {
    context.error(
      'no-plans-nor-addons',
      'A pricing must define at least one plan or one add-on.',
      []
    );
  }
}
