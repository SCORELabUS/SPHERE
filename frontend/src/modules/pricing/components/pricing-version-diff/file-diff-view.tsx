import { useMemo, useState } from 'react';
import { FiCheckCircle, FiChevronsDown, FiChevronsUp, FiMoreHorizontal } from 'react-icons/fi';
import {
  diffText,
  foldUnchanged,
  type DiffCell,
  type DiffRow,
  type RowKind,
  type Segment,
} from '../../utils/text-diff';

interface FileDiffViewProps {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
}

type Side = 'left' | 'right';

const CELL_STYLES: Record<Side, { row: string; gutter: string; mark: string }> = {
  left: { row: 'bg-red-50', gutter: 'bg-red-100 text-red-700', mark: 'bg-red-200' },
  right: {
    row: 'bg-emerald-50',
    gutter: 'bg-emerald-100 text-emerald-700',
    mark: 'bg-emerald-200',
  },
};

const isHighlighted = (kind: RowKind, side: Side) =>
  kind === 'change' || (side === 'left' ? kind === 'remove' : kind === 'add');

function Text({ cell, side }: { cell: DiffCell; side: Side }) {
  if (!cell.segments) return <>{cell.text || ' '}</>;
  return (
    <>
      {cell.segments.map((segment: Segment, index) =>
        segment.changed ? (
          <mark key={index} className={`rounded-sm text-tp-ink ${CELL_STYLES[side].mark}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

function Cell({ cell, kind, side }: { cell: DiffCell | null; kind: RowKind; side: Side }) {
  const highlighted = cell !== null && isHighlighted(kind, side);
  const styles = CELL_STYLES[side];
  return (
    <>
      <span
        className={`select-none px-2 py-0.5 text-right font-mono text-xs leading-6 tabular-nums ${
          side === 'right' ? 'border-l border-tp-hairline-strong' : ''
        } ${highlighted ? styles.gutter : cell ? 'bg-tp-surface text-tp-muted' : 'bg-tp-surface'}`}
      >
        {cell?.lineNumber ?? ''}
      </span>
      <span
        className={`min-w-0 whitespace-pre-wrap break-words px-3 py-0.5 font-mono text-[13px] leading-6 text-tp-ink ${
          highlighted ? styles.row : cell ? '' : 'bg-tp-surface'
        }`}
      >
        {cell ? <Text cell={cell} side={side} /> : null}
      </span>
    </>
  );
}

function Row({ row }: { row: DiffRow }) {
  return (
    <div className="contents">
      <Cell cell={row.left} kind={row.kind} side="left" />
      <Cell cell={row.right} kind={row.kind} side="right" />
    </div>
  );
}

/** Two files side by side, with the lines and words that differ highlighted. */
export default function FileDiffView({
  before,
  after,
  beforeLabel,
  afterLabel,
}: FileDiffViewProps) {
  const diff = useMemo(() => diffText(before, after), [before, after]);
  const blocks = useMemo(() => foldUnchanged(diff.rows), [diff.rows]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const hasFolds = blocks.some(block => block.type === 'collapsed');

  if (diff.additions === 0 && diff.removals === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center">
        <FiCheckCircle className="h-6 w-6 text-emerald-600" />
        <p className="text-sm font-medium text-tp-ink">The two files are identical</p>
        <p className="text-sm text-tp-slate">Every line matches.</p>
      </div>
    );
  }

  const expand = (id: number) => setExpanded(current => new Set(current).add(id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 font-medium text-red-800">
            {diff.removals} {diff.removals === 1 ? 'line' : 'lines'} removed
          </span>
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800">
            {diff.additions} {diff.additions === 1 ? 'line' : 'lines'} added
          </span>
        </div>
        {hasFolds ? (
          <button
            type="button"
            onClick={() => setExpandAll(current => !current)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:border-tp-primary/40"
          >
            {expandAll ? (
              <FiChevronsUp className="h-3.5 w-3.5" />
            ) : (
              <FiChevronsDown className="h-3.5 w-3.5" />
            )}
            {expandAll ? 'Hide unchanged lines' : 'Show unchanged lines'}
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-tp-hairline-strong bg-tp-canvas">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] border-b border-tp-hairline-strong bg-tp-surface text-xs font-semibold text-tp-slate">
            <span className="col-span-2 truncate px-3 py-2">{beforeLabel}</span>
            <span className="col-span-2 truncate border-l border-tp-hairline-strong px-3 py-2">
              {afterLabel}
            </span>
          </div>
          <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)]">
            {blocks.map((block, blockIndex) => {
              if (block.type === 'rows') {
                return block.rows.map((row, rowIndex) => (
                  <Row key={`${blockIndex}-${rowIndex}`} row={row} />
                ));
              }
              if (expandAll || expanded.has(block.id)) {
                return block.rows.map((row, rowIndex) => (
                  <Row key={`${blockIndex}-${rowIndex}`} row={row} />
                ));
              }
              return (
                <button
                  key={`fold-${block.id}`}
                  type="button"
                  onClick={() => expand(block.id)}
                  className="col-span-4 flex cursor-pointer items-center justify-center gap-2 border-y border-tp-hairline bg-tp-surface px-3 py-1.5 text-xs font-medium text-tp-slate transition-colors hover:bg-tp-hairline/40 hover:text-tp-ink"
                >
                  <FiMoreHorizontal className="h-4 w-4" />
                  Show {block.rows.length} unchanged lines
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
