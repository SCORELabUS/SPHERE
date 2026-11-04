import { useEffect, useMemo, useState } from 'react';

import { countBySeverity, lintPricing2Yaml, type LintResult } from '../services/pricing2yaml/linter';

const DEFAULT_DELAY_MS = 400;

const EMPTY_RESULT: LintResult = { diagnostics: [], hasSyntaxError: false };

export interface Pricing2YamlLintState extends LintResult {
  errors: number;
  warnings: number;
  /** The text this result belongs to, `null` before the first run. */
  lintedValue: string | null;
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
  const [state, setState] = useState<{ result: LintResult; lintedValue: string | null }>({
    result: EMPTY_RESULT,
    lintedValue: null,
  });

  useEffect(() => {
    if (!value) {
      setState({ result: EMPTY_RESULT, lintedValue: value });

      return;
    }

    const timeout = setTimeout(() => {
      setState({ result: lintPricing2Yaml(value), lintedValue: value });
    }, delayMs);

    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return useMemo(
    () => ({ ...state.result, ...countBySeverity(state.result.diagnostics), lintedValue: state.lintedValue }),
    [state]
  );
}
