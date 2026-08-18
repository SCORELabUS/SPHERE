import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
  type YAMLError,
  type YAMLWarning,
} from 'yaml';

import type { LintDiagnostic, LintPosition, LintRuleCode, NodePath, PathTarget } from './types';

const FIRST_CHARACTER: LintPosition = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 2,
};

/**
 * Wraps a parsed YAML document and exposes the two things every rule needs: the
 * plain JavaScript projection of the document, and a way to turn a node path
 * such as `['plans', 'PRO', 'price']` into an editor range.
 */
export class Pricing2YamlDocument {
  private constructor(
    private readonly doc: Document.Parsed,
    private readonly lineCounter: LineCounter
  ) {}

  static parse(text: string): Pricing2YamlDocument {
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter, keepSourceTokens: true });

    return new Pricing2YamlDocument(doc, lineCounter);
  }

  /**
   * Errors reported by the YAML parser itself (bad indentation, duplicate keys,
   * unclosed quotes...). These already carry accurate offsets.
   */
  get parserDiagnostics(): LintDiagnostic[] {
    const toDiagnostic = (
      issue: YAMLError | YAMLWarning,
      severity: LintDiagnostic['severity']
    ): LintDiagnostic => ({
      ...this.positionFromOffsets(issue.pos[0], issue.pos[1]),
      severity,
      code: issue.code === 'DUPLICATE_KEY' ? 'duplicate-key' : ('yaml-syntax' as LintRuleCode),
      // Parser messages embed a source excerpt across several lines; only the
      // first line is useful once the problem is underlined in place.
      message: issue.message.split('\n')[0].trim(),
      path: '',
    });

    return [
      ...this.doc.errors.map(error => toDiagnostic(error, 'error')),
      ...this.doc.warnings.map(warning => toDiagnostic(warning, 'warning')),
    ];
  }

  get hasParserErrors(): boolean {
    return this.doc.errors.length > 0;
  }

  get isEmpty(): boolean {
    return this.doc.contents === null;
  }

  /**
   * Plain JS projection of the document. Returns `undefined` when the document is
   * too broken to be converted, so callers can fall back to syntax errors only.
   */
  toJS(): unknown {
    try {
      return this.doc.toJS({ maxAliasCount: 100 });
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves a node path to an editor range. Falls back to the closest resolvable
   * ancestor — and ultimately to the first character — so a diagnostic always
   * points somewhere meaningful, even when the offending field is absent.
   */
  locate(path: NodePath, target: PathTarget = 'value'): LintPosition {
    for (let length = path.length; length >= 0; length--) {
      const isExact = length === path.length;
      const node = this.resolve(path.slice(0, length), isExact ? target : 'key');
      const range = node?.range;

      if (range) {
        // The root node spans the whole document; underlining all of it would be
        // useless noise, so a diagnostic that only resolves to the root is
        // anchored to the very first character instead.
        const end = length === 0 ? range[0] : range[1];

        return this.positionFromOffsets(range[0], end);
      }
    }

    return FIRST_CHARACTER;
  }

  private resolve(path: NodePath, target: PathTarget): Node | null {
    let node: unknown = this.doc.contents;

    for (const [index, segment] of path.entries()) {
      const isLast = index === path.length - 1;

      if (isMap(node)) {
        const pair = node.items.find(
          item => isScalar(item.key) && String(item.key.value) === String(segment)
        );

        if (!pair) {
          return null;
        }

        if (isLast) {
          return this.pickPairNode(pair.key as Node | null, pair.value as Node | null, target);
        }

        node = pair.value;
      } else if (isSeq(node)) {
        const position = Number(segment);
        const item = Number.isInteger(position) ? node.items[position] : undefined;

        if (item === undefined) {
          return null;
        }

        if (isLast) {
          return item as Node;
        }

        node = item;
      } else {
        return null;
      }
    }

    return (node ?? null) as Node | null;
  }

  private pickPairNode(key: Node | null, value: Node | null, target: PathTarget): Node | null {
    if (target === 'key') {
      return key ?? value;
    }

    if (!value) {
      return key;
    }

    // Collections span many lines; underlining the key keeps the marker tight.
    return isMap(value) || isSeq(value) ? (key ?? value) : value;
  }

  private positionFromOffsets(start: number, end: number): LintPosition {
    const startPosition = this.lineCounter.linePos(start);
    const endPosition = this.lineCounter.linePos(Math.max(end, start + 1));

    return {
      startLineNumber: startPosition.line,
      startColumn: startPosition.col,
      endLineNumber: endPosition.line,
      endColumn: endPosition.col,
    };
  }
}
