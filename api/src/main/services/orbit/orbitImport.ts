import { OrbitAssignableRole, OrbitIgnoredRow } from '../../types/models/Orbit';

/**
 * The pure half of ORBIT's file import: reading the file into rows and applying
 * an interpretation rule to every one of them. The model only ever decides the
 * rule (or, for irregular files, reads blocks of lines); turning that into
 * organizations and members, and accounting for every row, is done here.
 */

export interface TableRecord {
  /** 1-based line number in the file, as the user would count it. */
  line: number;
  cells: string[];
  /** The line as written, for the model to read when the file has no structure. */
  text: string;
}

export interface ParsedTable {
  delimiter: string | null;
  records: TableRecord[];
  columnCount: number;
}

export type ImportStructure = 'path' | 'parent' | 'levels' | 'members_only' | 'freeform';

export interface OrbitImportRule {
  hasHeader: boolean;
  structure: ImportStructure;
  pathColumn?: number | null;
  pathSeparator?: string | null;
  nameColumn?: number | null;
  parentColumn?: number | null;
  levelColumns?: number[] | null;
  descriptionColumn?: number | null;
  memberColumn?: number | null;
  memberOrgColumn?: number | null;
  roleColumn?: number | null;
  roleMapping?: Record<string, string> | null;
  defaultRole?: string | null;
}

export interface ImportNode {
  key: string;
  displayName: string;
  parentKey: string | null;
  description: string | null;
}

export interface ImportMember {
  orgKey: string;
  identifier: string;
  role: OrbitAssignableRole;
  line: number;
}

export interface ImportInterpretation {
  nodes: ImportNode[];
  /** The rows that described each organization, in child → parent files. */
  nodeLines: Map<string, number[]>;
  /**
   * Parents named in the file that are not organizations of the file itself.
   * They can only be existing organizations; the service looks them up.
   */
  externalParents: Map<string, string>;
  members: ImportMember[];
  usedLines: Set<number>;
  ignored: OrbitIgnoredRow[];
  notes: string[];
}

/** One line of an irregular file, as the model read it. */
export interface FreeformEntry {
  line: number;
  action: 'use' | 'ignore';
  path?: string[] | null;
  member?: string | null;
  role?: string | null;
  reason?: string | null;
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];
const MAX_NOTES = 15;

export function parseDelimitedText(text: string): ParsedTable {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const delimiter = detectDelimiter(lines);

  const records: TableRecord[] = [];
  let columnCount = 0;
  let pending: { startLine: number; text: string } | null = null;

  for (const [index, rawLine] of lines.entries()) {
    // A quoted cell may run over several lines; keep reading until its quotes close.
    const current: { startLine: number; text: string } = pending
      ? { startLine: pending.startLine, text: `${pending.text}\n${rawLine}` }
      : { startLine: index + 1, text: rawLine };

    if (delimiter && hasOpenQuote(current.text)) {
      pending = current;
      continue;
    }
    pending = null;

    if (!current.text.trim()) continue;
    const cells = delimiter ? splitLine(current.text, delimiter) : [current.text.trim()];
    if (cells.every(cell => !cell)) continue;
    records.push({ line: current.startLine, cells, text: current.text.trim() });
    columnCount = Math.max(columnCount, cells.length);
  }

  if (pending && pending.text.trim()) {
    const cells = splitLine(pending.text, delimiter as string);
    records.push({ line: pending.startLine, cells, text: pending.text.trim() });
    columnCount = Math.max(columnCount, cells.length);
  }

  return { delimiter, records, columnCount };
}

function detectDelimiter(lines: string[]): string | null {
  const sample = lines.filter(line => line.trim()).slice(0, 25);
  let best: { delimiter: string; score: number; columns: number } | null = null;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sample.map(line => splitLine(line, delimiter).length);
    const frequency = new Map<number, number>();
    for (const count of counts) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    const [columns, hits] = [...frequency.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [1, 0];
    if (columns < 2) continue;
    const score = hits / sample.length;
    if (!best || score > best.score || (score === best.score && columns > best.columns)) {
      best = { delimiter, score, columns };
    }
  }

  return best && best.score >= 0.6 ? best.delimiter : null;
}

function hasOpenQuote(text: string): boolean {
  let open = false;
  for (const char of text) if (char === '"') open = !open;
  return open;
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else if (char === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Problems with a rule the model returned, so it can be asked again. */
export function validateRule(rule: OrbitImportRule, columnCount: number): string[] {
  const errors: string[] = [];
  const checkColumn = (name: keyof OrbitImportRule, required: boolean) => {
    const value = rule[name];
    if (value === null || value === undefined) {
      if (required) errors.push(`"${name}" is required for structure "${rule.structure}".`);
      return;
    }
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= columnCount) {
      errors.push(`"${name}" must be a column index between 0 and ${columnCount - 1}.`);
    }
  };

  switch (rule.structure) {
    case 'path':
      checkColumn('pathColumn', true);
      if (!rule.pathSeparator) errors.push('"pathSeparator" is required for structure "path".');
      break;
    case 'parent':
      checkColumn('nameColumn', true);
      checkColumn('parentColumn', true);
      break;
    case 'levels':
      if (!Array.isArray(rule.levelColumns) || rule.levelColumns.length === 0) {
        errors.push('"levelColumns" must list at least one column for structure "levels".');
      } else if (rule.levelColumns.some(column => !Number.isInteger(column) || column < 0 || column >= columnCount)) {
        errors.push(`Every entry of "levelColumns" must be a column index between 0 and ${columnCount - 1}.`);
      }
      break;
    case 'members_only':
      checkColumn('memberColumn', true);
      checkColumn('memberOrgColumn', true);
      break;
    case 'freeform':
      return errors;
    default:
      errors.push(`"structure" must be one of path, parent, levels, members_only or freeform.`);
      return errors;
  }

  checkColumn('descriptionColumn', false);
  checkColumn('memberColumn', false);
  checkColumn('roleColumn', false);
  if (rule.defaultRole && !['ADMIN', 'MEMBER'].includes(String(rule.defaultRole).toUpperCase())) {
    errors.push('"defaultRole" must be ADMIN or MEMBER.');
  }
  return errors;
}

/** Applies a structured rule to every data row of the table. */
export function applyRule(table: ParsedTable, rule: OrbitImportRule): ImportInterpretation {
  const data = rule.hasHeader ? table.records.slice(1) : table.records;
  const builder = new InterpretationBuilder(rule);

  if (rule.structure === 'parent') {
    applyParentRule(data, rule, builder);
  } else {
    for (const record of data) {
      const cell = (column: number | null | undefined) =>
        column === null || column === undefined ? '' : (record.cells[column] ?? '').trim();

      let segments: string[] = [];
      if (rule.structure === 'path') {
        segments = splitPath(cell(rule.pathColumn), rule.pathSeparator as string);
      } else if (rule.structure === 'levels') {
        segments = (rule.levelColumns ?? []).map(column => cell(column)).filter(Boolean);
      } else if (rule.structure === 'members_only') {
        const group = cell(rule.memberOrgColumn);
        segments = rule.pathSeparator ? splitPath(group, rule.pathSeparator) : group ? [group] : [];
      }

      builder.addPathRow(record.line, segments, {
        description: cell(rule.descriptionColumn) || null,
        member: cell(rule.memberColumn) || null,
        role: cell(rule.roleColumn) || null,
      });
    }
  }

  return builder.finish(data.map(record => record.line));
}

/** Builds the interpretation of an irregular file from what the model read line by line. */
export function interpretFreeform(
  lines: number[],
  entries: FreeformEntry[],
  defaultRole: string | null = null
): ImportInterpretation {
  const builder = new InterpretationBuilder({ hasHeader: false, structure: 'freeform', defaultRole });
  const expected = new Set(lines);

  for (const entry of entries) {
    if (!expected.has(entry.line)) continue;
    if (entry.action === 'ignore') {
      builder.ignore(entry.line, entry.reason?.trim() || 'Ignored by the assistant');
      continue;
    }
    const segments = Array.isArray(entry.path)
      ? entry.path.map(segment => String(segment ?? '').trim()).filter(Boolean)
      : [];
    builder.addPathRow(entry.line, segments, {
      description: null,
      member: entry.member ? String(entry.member).trim() : null,
      role: entry.role ? String(entry.role) : null,
    });
  }

  return builder.finish(lines);
}

function applyParentRule(data: TableRecord[], rule: OrbitImportRule, builder: InterpretationBuilder) {
  for (const record of data) {
    const cell = (column: number | null | undefined) =>
      column === null || column === undefined ? '' : (record.cells[column] ?? '').trim();
    const name = cell(rule.nameColumn);
    const parent = cell(rule.parentColumn);
    const member = cell(rule.memberColumn) || null;

    if (!name) {
      builder.ignore(record.line, 'The row has no organization name');
      continue;
    }
    builder.addParentRow(record.line, name, parent || null, {
      description: cell(rule.descriptionColumn) || null,
      member,
      role: cell(rule.roleColumn) || null,
    });
  }
  builder.resolveParents();
}

function splitPath(value: string, separator: string): string[] {
  if (!value) return [];
  return value.split(separator).map(segment => segment.trim()).filter(Boolean);
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

class InterpretationBuilder {
  private nodes = new Map<string, ImportNode>();
  private nodeLines = new Map<string, number[]>();
  private members: ImportMember[] = [];
  private used = new Set<number>();
  private ignoredRows = new Map<number, string>();
  private notes: string[] = [];
  private droppedNotes = 0;
  private externalParents = new Map<string, string>();
  /** Names as the file first wrote them, keyed by their normalized form. */
  private writtenNames = new Map<string, string>();
  private roleMapping: Map<string, OrbitAssignableRole>;
  private defaultRole: OrbitAssignableRole;

  constructor(rule: Pick<OrbitImportRule, 'hasHeader' | 'structure' | 'roleMapping' | 'defaultRole'>) {
    this.defaultRole = String(rule.defaultRole ?? '').toUpperCase() === 'ADMIN' ? 'ADMIN' : 'MEMBER';
    this.roleMapping = new Map();
    for (const [value, role] of Object.entries(rule.roleMapping ?? {})) {
      const normalized = String(role).toUpperCase();
      if (normalized === 'ADMIN' || normalized === 'MEMBER') {
        this.roleMapping.set(normalizeName(value), normalized);
      }
    }
  }

  ignore(line: number, reason: string) {
    if (!this.used.has(line)) this.ignoredRows.set(line, reason);
  }

  addPathRow(
    line: number,
    segments: string[],
    extra: { description: string | null; member: string | null; role: string | null }
  ) {
    if (segments.length === 0) {
      this.ignore(line, extra.member ? `No organization is given for ${extra.member}` : 'The row has no organization');
      return;
    }

    let parentKey: string | null = null;
    for (const segment of segments) {
      const key: string = parentKey ? `${parentKey}/${normalizeName(segment)}` : normalizeName(segment);
      if (!this.nodes.has(key)) {
        this.nodes.set(key, { key, displayName: segment, parentKey, description: null });
      }
      parentKey = key;
    }

    const leaf = this.nodes.get(parentKey as string)!;
    if (extra.description && !leaf.description) leaf.description = extra.description;
    if (extra.member) this.addMember(line, leaf.key, extra.member, extra.role);
    this.markUsed(line);
  }

  addParentRow(
    line: number,
    name: string,
    parent: string | null,
    extra: { description: string | null; member: string | null; role: string | null }
  ) {
    const key = normalizeName(name);
    const parentKey = parent ? normalizeName(parent) : null;

    if (parentKey === key) {
      this.ignore(line, `"${name}" cannot be its own parent`);
      return;
    }

    const existing = this.nodes.get(key);
    if (parent && parentKey && !this.writtenNames.has(parentKey)) this.writtenNames.set(parentKey, parent);
    if (!this.writtenNames.has(key)) this.writtenNames.set(key, name);

    if (existing && existing.parentKey !== parentKey) {
      const placed = existing.parentKey ? `under "${this.writtenNames.get(existing.parentKey)}"` : 'at the top level';
      this.ignore(line, `"${name}" was already placed ${placed} by an earlier row`);
      return;
    }
    if (!existing) {
      this.nodes.set(key, { key, displayName: name, parentKey, description: null });
      if (parent && parentKey) this.externalParents.set(parentKey, parent);
    }

    const node = this.nodes.get(key)!;
    if (extra.description && !node.description) node.description = extra.description;
    if (extra.member) this.addMember(line, key, extra.member, extra.role);
    this.nodeLines.set(key, [...(this.nodeLines.get(key) ?? []), line]);
    this.markUsed(line);
  }

  /**
   * In a child → parent file, a parent is either another row of the file or an
   * organization that already exists. Rows that hang from something on a cycle
   * are dropped, along with whatever hangs from them.
   */
  resolveParents() {
    for (const key of this.nodes.keys()) this.externalParents.delete(key);

    // A node is on a cycle when climbing from its parent leads back to it.
    const dropped = new Map<string, string>();
    for (const node of this.nodes.values()) {
      let current = node.parentKey;
      for (let steps = 0; current && this.nodes.has(current) && steps <= this.nodes.size; steps++) {
        if (current === node.key) {
          dropped.set(node.key, `"${node.displayName}" is part of a cycle of parents`);
          break;
        }
        current = this.nodes.get(current)!.parentKey;
      }
    }

    // Anything below a dropped organization has nowhere to go either.
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.nodes.values()) {
        if (!dropped.has(node.key) && node.parentKey && dropped.has(node.parentKey)) {
          dropped.set(node.key, `"${node.displayName}" hangs from "${this.nodes.get(node.parentKey)?.displayName}", which was left out`);
          changed = true;
        }
      }
    }

    for (const [key, reason] of dropped) {
      this.nodes.delete(key);
      this.members = this.members.filter(member => member.orgKey !== key);
      for (const line of this.nodeLines.get(key) ?? []) {
        this.used.delete(line);
        this.ignoredRows.set(line, reason);
      }
    }
  }

  finish(allLines: number[]): ImportInterpretation {
    // Every line ends up either used or ignored with its reason: none is lost.
    for (const line of allLines) {
      if (!this.used.has(line) && !this.ignoredRows.has(line)) {
        this.ignoredRows.set(line, 'The interpretation did not use this row');
      }
    }
    if (this.droppedNotes > 0) this.notes.push(`…and ${this.droppedNotes} more notes like these.`);

    return {
      nodes: [...this.nodes.values()],
      nodeLines: this.nodeLines,
      externalParents: this.externalParents,
      members: this.members,
      usedLines: this.used,
      ignored: [...this.ignoredRows.entries()]
        .map(([row, reason]) => ({ row, reason }))
        .sort((a, b) => a.row - b.row),
      notes: this.notes,
    };
  }

  private addMember(line: number, orgKey: string, identifier: string, rawRole: string | null) {
    this.members.push({ orgKey, identifier, role: this.resolveRole(line, rawRole), line });
  }

  private resolveRole(line: number, rawRole: string | null): OrbitAssignableRole {
    if (!rawRole) return this.defaultRole;
    const normalized = normalizeName(rawRole);
    const mapped = this.roleMapping.get(normalized);
    if (mapped) return mapped;
    if (normalized === 'admin') return 'ADMIN';
    if (normalized === 'member') return 'MEMBER';
    if (normalized === 'owner') {
      this.note(`Line ${line}: "${rawRole}" would make a second owner; ADMIN was used instead.`);
      return 'ADMIN';
    }
    this.note(`Line ${line}: unknown role "${rawRole}", ${this.defaultRole} was used.`);
    return this.defaultRole;
  }

  private markUsed(line: number) {
    this.used.add(line);
    this.ignoredRows.delete(line);
  }

  private note(text: string) {
    if (this.notes.length < MAX_NOTES) this.notes.push(text);
    else this.droppedNotes++;
  }
}

/**
 * Drops the organizations of a child → parent file that hang from a parent the
 * file names but that does not exist, with the rows that described them.
 */
export function dropMissingExternalParents(
  interpretation: ImportInterpretation,
  missing: Map<string, string>
): ImportInterpretation {
  if (missing.size === 0) return interpretation;

  const nodes = new Map(interpretation.nodes.map(node => [node.key, node]));
  const doomed = new Map<string, string>();
  for (const node of nodes.values()) {
    if (node.parentKey && missing.has(node.parentKey)) {
      doomed.set(node.key, `The parent "${missing.get(node.parentKey)}" is neither in the file nor an existing organization`);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes.values()) {
      if (!doomed.has(node.key) && node.parentKey && doomed.has(node.parentKey)) {
        doomed.set(node.key, `"${node.displayName}" hangs from "${nodes.get(node.parentKey)?.displayName}", which was left out`);
        changed = true;
      }
    }
  }

  const ignored = new Map(interpretation.ignored.map(entry => [entry.row, entry.reason]));
  const usedLines = new Set(interpretation.usedLines);
  for (const [key, reason] of doomed) {
    for (const line of interpretation.nodeLines.get(key) ?? []) {
      usedLines.delete(line);
      ignored.set(line, reason);
    }
  }
  const members = interpretation.members.filter(member => !doomed.has(member.orgKey));

  return {
    ...interpretation,
    nodes: interpretation.nodes.filter(node => !doomed.has(node.key)),
    externalParents: new Map(
      [...interpretation.externalParents.entries()].filter(([key]) => !missing.has(key))
    ),
    members,
    usedLines,
    ignored: [...ignored.entries()].map(([row, reason]) => ({ row, reason })).sort((a, b) => a.row - b.row),
  };
}
