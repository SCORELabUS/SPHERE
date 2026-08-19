import type { Pricing2YamlDocument } from './document';
import type { LintDiagnostic, LintRuleCode, LintSeverity, NodePath, PathTarget } from './types';

export interface ReportInput {
  severity: LintSeverity;
  code: LintRuleCode;
  message: string;
  path: NodePath;
  /** Underline the key instead of the value. Defaults to `value`. */
  target?: PathTarget;
}

/**
 * Shared state handed to every rule: the raw document (for positions), its plain
 * JS projection (for reading values) and the sink diagnostics are pushed into.
 */
export class LintContext {
  private readonly diagnostics: LintDiagnostic[] = [];

  constructor(
    readonly document: Pricing2YamlDocument,
    readonly pricing: Record<string, unknown>
  ) {}

  report({ severity, code, message, path, target = 'value' }: ReportInput): void {
    this.diagnostics.push({
      ...this.document.locate(path, target),
      severity,
      code,
      message,
      path: formatPath(path),
    });
  }

  error(code: LintRuleCode, message: string, path: NodePath, target?: PathTarget): void {
    this.report({ severity: 'error', code, message, path, target });
  }

  warn(code: LintRuleCode, message: string, path: NodePath, target?: PathTarget): void {
    this.report({ severity: 'warning', code, message, path, target });
  }

  collect(): LintDiagnostic[] {
    return this.diagnostics;
  }

  /** Reads a map at the given root key, or an empty map when absent or malformed. */
  mapAt(key: string): Record<string, unknown> {
    const value = this.pricing[key];

    return isPlainObject(value) ? value : {};
  }

  /** Names declared under a root map, used for referential integrity checks. */
  namesOf(key: string): string[] {
    return Object.keys(this.mapAt(key));
  }
}

export function formatPath(path: NodePath): string {
  return path.reduce<string>((accumulator, segment) => {
    if (typeof segment === 'number') {
      return `${accumulator}[${segment}]`;
    }

    return accumulator ? `${accumulator}.${segment}` : segment;
  }, '');
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/** Human-readable type name used in diagnostic messages. */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (value instanceof Date) return 'a date';

  return `a ${typeof value}`;
}
