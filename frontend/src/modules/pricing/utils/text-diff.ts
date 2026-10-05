export type DiffOpKind = 'equal' | 'remove' | 'add';

export interface DiffOp<T> {
  kind: DiffOpKind;
  value: T;
}

export interface Segment {
  text: string;
  changed: boolean;
}

export interface DiffCell {
  /** 1-based line number in its own file. */
  lineNumber: number;
  text: string;
  /** Word-level pieces, present when the line was edited rather than added or removed. */
  segments?: Segment[];
}

export type RowKind = 'equal' | 'change' | 'remove' | 'add';

export interface DiffRow {
  kind: RowKind;
  left: DiffCell | null;
  right: DiffCell | null;
}

export type DiffBlock =
  { type: 'rows'; rows: DiffRow[] } | { type: 'collapsed'; id: number; rows: DiffRow[] };

export interface TextDiff {
  rows: DiffRow[];
  additions: number;
  removals: number;
}

// Above this many cells the quadratic table gets too large; the changed region
// is then reported as a plain replacement instead.
const MAX_TABLE_CELLS = 4_000_000;

function lcsDiff<T>(a: T[], b: T[]): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map(value => ({ kind: 'add', value }));
  if (m === 0) return a.map(value => ({ kind: 'remove', value }));
  if (n * m > MAX_TABLE_CELLS) {
    return [
      ...a.map<DiffOp<T>>(value => ({ kind: 'remove', value })),
      ...b.map<DiffOp<T>>(value => ({ kind: 'add', value })),
    ];
  }

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops: DiffOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', value: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ kind: 'remove', value: a[i++] });
    } else {
      ops.push({ kind: 'add', value: b[j++] });
    }
  }
  while (i < n) ops.push({ kind: 'remove', value: a[i++] });
  while (j < m) ops.push({ kind: 'add', value: b[j++] });
  return ops;
}

/** Shortest edit script between two sequences. Unchanged ends are trimmed first. */
export function diffSequences<T>(a: T[], b: T[]): DiffOp<T>[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: DiffOp<T>[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: 'equal', value: a[i] });
  ops.push(...lcsDiff(a.slice(start, endA), b.slice(start, endB)));
  for (let i = endA; i < a.length; i++) ops.push({ kind: 'equal', value: a[i] });
  return ops;
}

const tokenize = (line: string) => line.match(/\s+|\w+|[^\s\w]/g) ?? [];

function pushSegment(segments: Segment[], text: string, changed: boolean) {
  const last = segments[segments.length - 1];
  if (last && last.changed === changed) last.text += text;
  else segments.push({ text, changed });
}

/** Highlights which words of two paired lines differ. */
function wordSegments(before: string, after: string): { left: Segment[]; right: Segment[] } {
  const left: Segment[] = [];
  const right: Segment[] = [];
  for (const op of diffSequences(tokenize(before), tokenize(after))) {
    if (op.kind === 'equal') {
      pushSegment(left, op.value, false);
      pushSegment(right, op.value, false);
    } else if (op.kind === 'remove') {
      pushSegment(left, op.value, true);
    } else {
      pushSegment(right, op.value, true);
    }
  }
  return { left, right };
}

const splitLines = (text: string) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/** Side-by-side comparison of two texts, `before` on the left. */
export function diffText(before: string, after: string): TextDiff {
  const ops = diffSequences(splitLines(before), splitLines(after));
  const rows: DiffRow[] = [];
  let additions = 0;
  let removals = 0;
  let leftNo = 0;
  let rightNo = 0;

  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.kind === 'equal') {
      leftNo++;
      rightNo++;
      rows.push({
        kind: 'equal',
        left: { lineNumber: leftNo, text: op.value },
        right: { lineNumber: rightNo, text: op.value },
      });
      index++;
      continue;
    }

    // A run of removals and additions between two unchanged lines: pair them
    // up row by row so an edited line reads as one change.
    const removed: string[] = [];
    const added: string[] = [];
    while (index < ops.length && ops[index].kind !== 'equal') {
      if (ops[index].kind === 'remove') removed.push(ops[index].value);
      else added.push(ops[index].value);
      index++;
    }
    removals += removed.length;
    additions += added.length;

    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++) {
      const segments = wordSegments(removed[k], added[k]);
      rows.push({
        kind: 'change',
        left: { lineNumber: ++leftNo, text: removed[k], segments: segments.left },
        right: { lineNumber: ++rightNo, text: added[k], segments: segments.right },
      });
    }
    for (let k = paired; k < removed.length; k++) {
      rows.push({ kind: 'remove', left: { lineNumber: ++leftNo, text: removed[k] }, right: null });
    }
    for (let k = paired; k < added.length; k++) {
      rows.push({ kind: 'add', left: null, right: { lineNumber: ++rightNo, text: added[k] } });
    }
  }

  return { rows, additions, removals };
}

/**
 * Groups rows so that long unchanged stretches can be folded away, keeping
 * `context` unchanged lines around every difference.
 */
export function foldUnchanged(rows: DiffRow[], context = 3, minFolded = 4): DiffBlock[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.kind === 'equal') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(rows.length - 1, index + context);
      k++
    ) {
      keep[k] = true;
    }
  });

  const blocks: DiffBlock[] = [];
  let current: DiffRow[] = [];
  let foldedId = 0;
  const flush = () => {
    if (current.length > 0) blocks.push({ type: 'rows', rows: current });
    current = [];
  };

  let index = 0;
  while (index < rows.length) {
    if (keep[index]) {
      current.push(rows[index++]);
      continue;
    }
    let end = index;
    while (end < rows.length && !keep[end]) end++;
    const folded = rows.slice(index, end);
    if (folded.length >= minFolded) {
      flush();
      blocks.push({ type: 'collapsed', id: foldedId++, rows: folded });
    } else {
      current.push(...folded);
    }
    index = end;
  }
  flush();
  return blocks;
}
