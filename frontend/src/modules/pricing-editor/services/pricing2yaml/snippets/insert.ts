import { SECTION_ORDER, type SnippetSection } from './types';

/** Indentation used when a section has no children to copy it from. */
const DEFAULT_INDENT = '  ';

/**
 * Where a snippet has to land, expressed as the range it replaces plus the text
 * that goes in its place. An empty range is a plain insertion.
 *
 * Line and column numbers are 1-based, like Monaco's.
 */
export interface SnippetPlacement {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  text: string;
}

/**
 * Works out where a block belongs inside the document.
 *
 * The point is that the user should not have to scroll to the right section
 * first: wherever the caret is, a plan goes under `plans`, a feature under
 * `features`, and the section is created — in canonical order — if missing.
 */
export function planBlockInsertion(
  document: string,
  section: SnippetSection,
  body: string
): SnippetPlacement {
  const lines = document.split('\n');
  const headerIndex = findSectionHeader(lines, section);

  if (headerIndex === -1) {
    return planNewSection(lines, section, body);
  }

  // `usageLimits: null` and friends declare the section as empty, so the header
  // has to be rewritten before anything can be nested under it.
  if (hasInlineValue(lines[headerIndex])) {
    return {
      startLineNumber: headerIndex + 1,
      startColumn: 1,
      endLineNumber: headerIndex + 1,
      endColumn: lines[headerIndex].length + 1,
      text: `${section}:\n${indentBlock(body, DEFAULT_INDENT)}`,
    };
  }

  const endIndex = findSectionEnd(lines, headerIndex);
  const indent = detectSectionIndent(lines, headerIndex, endIndex);

  if (endIndex >= lines.length) {
    return planAppend(lines, indentBlock(body, indent));
  }

  return emptyPlacement(endIndex + 1, `${indentBlock(body, indent)}\n`);
}

/** Indents every non-blank line of a snippet body. */
export function indentBlock(body: string, indent: string): string {
  return body
    .split('\n')
    .map(line => (line.trim().length === 0 ? '' : `${indent}${line}`))
    .join('\n');
}

/** Index of the top-level `section:` header, or -1 when it is not declared. */
function findSectionHeader(lines: string[], section: SnippetSection): number {
  const pattern = new RegExp(`^${section}\\s*:`);

  return lines.findIndex(line => pattern.test(line));
}

/** True when the header carries a value (`null`, a flow map, ...) of its own. */
function hasInlineValue(line: string): boolean {
  const value = line.slice(line.indexOf(':') + 1).trim();

  return value.length > 0 && !value.startsWith('#');
}

function isTopLevelLine(line: string): boolean {
  return line.trim().length > 0 && !/^\s/.test(line);
}

/**
 * Index of the line the section ends before, ignoring the blank lines that
 * separate it from the next one so the block is not pushed past them.
 */
function findSectionEnd(lines: string[], headerIndex: number): number {
  let end = lines.length;

  for (let index = headerIndex + 1; index < lines.length; index++) {
    if (isTopLevelLine(lines[index])) {
      end = index;
      break;
    }
  }

  while (end > headerIndex + 1 && lines[end - 1].trim().length === 0) {
    end--;
  }

  return end;
}

/** Reuses the indentation the section already uses for its entries. */
function detectSectionIndent(lines: string[], headerIndex: number, endIndex: number): string {
  for (let index = headerIndex + 1; index < Math.min(endIndex, lines.length); index++) {
    const match = /^(\s+)\S/.exec(lines[index]);

    if (match) {
      return match[1];
    }
  }

  return DEFAULT_INDENT;
}

function planNewSection(
  lines: string[],
  section: SnippetSection,
  body: string
): SnippetPlacement {
  const text = `${section}:\n${indentBlock(body, DEFAULT_INDENT)}`;
  const successorIndex = findFirstLaterSection(lines, section);

  if (successorIndex !== -1) {
    return emptyPlacement(successorIndex + 1, `${text}\n`);
  }

  return planAppend(lines, text);
}

/** First declared section that should come after the given one. */
function findFirstLaterSection(lines: string[], section: SnippetSection): number {
  const successors = SECTION_ORDER.slice(SECTION_ORDER.indexOf(section) + 1);
  let best = -1;

  for (const candidate of successors) {
    const index = findSectionHeader(lines, candidate);

    if (index !== -1 && (best === -1 || index < best)) {
      best = index;
    }
  }

  return best;
}

function planAppend(lines: string[], text: string): SnippetPlacement {
  const lastIndex = Math.max(lines.length - 1, 0);
  const lastLine = lines[lastIndex] ?? '';

  if (lastLine.trim().length === 0) {
    return {
      startLineNumber: lastIndex + 1,
      startColumn: 1,
      endLineNumber: lastIndex + 1,
      endColumn: lastLine.length + 1,
      text: `${text}\n`,
    };
  }

  return {
    startLineNumber: lastIndex + 1,
    startColumn: lastLine.length + 1,
    endLineNumber: lastIndex + 1,
    endColumn: lastLine.length + 1,
    text: `\n${text}`,
  };
}

function emptyPlacement(lineNumber: number, text: string): SnippetPlacement {
  return {
    startLineNumber: lineNumber,
    startColumn: 1,
    endLineNumber: lineNumber,
    endColumn: 1,
    text,
  };
}
