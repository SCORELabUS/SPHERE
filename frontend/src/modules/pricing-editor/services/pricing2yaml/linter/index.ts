import { LintContext, isPlainObject } from './context';
import { Pricing2YamlDocument } from './document';
import { checkAddOns } from './rules/addons';
import { checkFeatures } from './rules/features';
import { checkPlans } from './rules/plans';
import {
  checkLinkedFeatures,
  checkUnreferencedElements,
  type PricingIndex,
} from './rules/references';
import { checkRootFields } from './rules/root';
import { checkUsageLimits } from './rules/usage-limits';
import type { LintDiagnostic, LintResult } from './types';

export type { LintDiagnostic, LintResult, LintSeverity, LintRuleCode } from './types';

const EMPTY_RESULT: LintResult = { diagnostics: [], hasSyntaxError: false };

/**
 * Lints a Pricing2Yaml document and returns every problem found, rather than
 * stopping at the first one the way `pricing4ts`' parser does.
 *
 * Semantic rules only run once the YAML parses, since a broken document yields
 * an unreliable object tree and would produce a cascade of misleading errors.
 */
export function lintPricing2Yaml(text: string): LintResult {
  if (text.trim().length === 0) {
    return EMPTY_RESULT;
  }

  const document = Pricing2YamlDocument.parse(text);
  const parserDiagnostics = document.parserDiagnostics;

  if (document.hasParserErrors) {
    return { diagnostics: sortDiagnostics(parserDiagnostics), hasSyntaxError: true };
  }

  if (document.isEmpty) {
    return { diagnostics: sortDiagnostics(parserDiagnostics), hasSyntaxError: false };
  }

  const pricing = document.toJS();

  if (!isPlainObject(pricing)) {
    return {
      diagnostics: sortDiagnostics([
        ...parserDiagnostics,
        {
          ...document.locate([]),
          severity: 'error',
          code: 'root-not-a-map',
          message: 'A pricing must be a map of fields at the root of the document.',
          path: '',
        },
      ]),
      hasSyntaxError: false,
    };
  }

  const context = new LintContext(document, pricing);

  checkRootFields(context);

  const index: PricingIndex = {
    features: checkFeatures(context),
    usageLimits: checkUsageLimits(context),
    planNames: new Set(context.namesOf('plans')),
    addOnNames: new Set(context.namesOf('addOns')),
  };

  checkLinkedFeatures(context, index);
  checkPlans(context, index);
  checkAddOns(context, index);
  checkUnreferencedElements(context, index);

  return {
    diagnostics: sortDiagnostics([...parserDiagnostics, ...context.collect()]),
    hasSyntaxError: false,
  };
}

function sortDiagnostics(diagnostics: LintDiagnostic[]): LintDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      left.startLineNumber - right.startLineNumber || left.startColumn - right.startColumn
  );
}

export function countBySeverity(diagnostics: LintDiagnostic[]): {
  errors: number;
  warnings: number;
} {
  return diagnostics.reduce(
    (accumulator, diagnostic) => {
      if (diagnostic.severity === 'error') {
        accumulator.errors += 1;
      } else if (diagnostic.severity === 'warning') {
        accumulator.warnings += 1;
      }

      return accumulator;
    },
    { errors: 0, warnings: 0 }
  );
}
