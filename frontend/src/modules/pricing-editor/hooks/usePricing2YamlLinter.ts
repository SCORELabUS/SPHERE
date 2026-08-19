import { useEffect, useMemo, useState } from 'react';

import { countBySeverity, lintPricing2Yaml, type LintResult } from '../services/pricing2yaml/linter';

const DEFAULT_DELAY_MS = 400;

const EMPTY_RESULT: LintResult = { diagnostics: [], hasSyntaxError: false };

export interface Pricing2YamlLintState extends LintResult {
  errors: number;
  warnings: number;
}

/**
 * Lints the given YAML off the typing critical path.
 *
 * The delay is shorter than the one guarding the preview parse: linting is a
 * pure, local computation, so it can react quickly without hitting the API.
 */
export function usePricing2YamlLinter(
  value: string,
  delayMs: number = DEFAULT_DELAY_MS
): Pricing2YamlLintState {
  const [result, setResult] = useState<LintResult>(EMPTY_RESULT);

  useEffect(() => {
    if (!value) {
      setResult(EMPTY_RESULT);

      return;
    }

    const timeout = setTimeout(() => {
      setResult(lintPricing2Yaml(value));
    }, delayMs);

    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return useMemo(() => ({ ...result, ...countBySeverity(result.diagnostics) }), [result]);
}
