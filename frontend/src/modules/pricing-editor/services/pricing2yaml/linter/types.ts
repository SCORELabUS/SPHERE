/**
 * Diagnostic model for the Pricing2Yaml linter.
 *
 * Positions are 1-based and mirror Monaco's `IMarkerData` so a diagnostic can be
 * handed to `setModelMarkers` without further conversion.
 */

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintPosition {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface LintDiagnostic extends LintPosition {
  severity: LintSeverity;
  /** Stable identifier of the rule that produced the diagnostic. */
  code: LintRuleCode;
  message: string;
  /** Path of the offending node inside the document, e.g. `plans.PRO.price`. */
  path: string;
}

export interface LintResult {
  diagnostics: LintDiagnostic[];
  /** True when the YAML itself could not be parsed, so semantic rules were skipped. */
  hasSyntaxError: boolean;
}

export type LintRuleCode =
  // Document level
  | 'yaml-syntax'
  | 'duplicate-key'
  | 'root-not-a-map'
  | 'missing-required-field'
  | 'unsupported-syntax-version'
  | 'invalid-type'
  | 'invalid-enum-value'
  | 'invalid-value'
  | 'invalid-name-length'
  | 'no-plans-nor-addons'
  // Element level
  | 'missing-conditional-field'
  | 'value-type-mismatch'
  | 'empty-addon'
  | 'invalid-subscription-constraints'
  // Referential integrity
  | 'unknown-feature-reference'
  | 'unknown-usage-limit-reference'
  | 'unknown-plan-reference'
  | 'unknown-addon-reference'
  | 'unknown-tag-reference'
  | 'unknown-variable-reference'
  | 'self-reference'
  // Hygiene
  | 'unused-feature'
  | 'unused-usage-limit'
  | 'unused-tag';

/** Path segments: strings address map keys, numbers address sequence indices. */
export type NodePath = Array<string | number>;

/** Which part of a mapping entry a diagnostic should underline. */
export type PathTarget = 'key' | 'value';
