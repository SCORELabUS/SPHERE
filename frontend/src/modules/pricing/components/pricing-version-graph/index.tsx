import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { usePricingsApi } from '../../api/pricingsApi';
import ChangeSummaryCard from './change-summary-card';
import { useVersionChanges, type ChangesTarget } from './use-version-changes';
import { useRouter } from '../../../core/hooks/useRouter';
import type { PricingGraph, PricingGraphLane } from '../../types/graph';
import {
  baseVersionOf,
  isLongLink,
  layoutGraph,
  nodeKey,
  routeEdge,
  type GraphEdge,
  type GraphLayout,
  type GraphNode,
} from '../../utils/version-graph';

interface PricingVersionGraphProps {
  organizationId: string;
  slug: string;
  /** Changes whenever the pricing's versions do, to draw the graph again. */
  refreshKey: string;
  currentVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
}

const LANE_HEIGHT = 64;
const COLUMN_WIDTH = 76;
const PAD_X = 34;
const DOT_Y = 26;
const DOT_RADIUS = 6;
/** Up to this many versions in all, every one is drawn: folding only pays off in large families. */
const FOLD_FROM = 13;
/** Longer version names are shortened under their dot (the full name is in the tooltip). */
const LABEL_CHARS = 11;

const ROLE_LABEL: Record<PricingGraphLane['role'], string> = {
  current: 'This pricing',
  source: 'Forked from',
};

/**
 * One color per kind of lane: the pricing shown and the one it was forked from.
 * Spelled out so Tailwind finds every class.
 */
const ROLE_COLORS = {
  current: {
    stroke: 'stroke-tp-primary',
    rail: 'stroke-tp-primary/50',
    fill: 'fill-tp-primary',
    soft: 'fill-tp-primary/15',
    dot: 'bg-tp-primary',
  },
  source: {
    stroke: 'stroke-sky-500',
    rail: 'stroke-sky-500/50',
    fill: 'fill-sky-500',
    soft: 'fill-sky-500/15',
    dot: 'bg-sky-500',
  },
} as const;

const x = (column: number) => PAD_X + column * COLUMN_WIDTH;
const y = (lane: number) => lane * LANE_HEIGHT + DOT_Y;

/** The line of a branch, by how it is routed (see routeEdge). */
function edgePath(edge: GraphEdge, layout: GraphLayout) {
  const x1 = x(edge.from.column);
  const y1 = y(edge.from.lane);
  const x2 = x(edge.to.column);
  const y2 = y(edge.to.lane);
  const span = Math.max(x2 - x1, 1);
  const bend = Math.min(COLUMN_WIDTH * 0.85, span);
  switch (routeEdge(edge, layout)) {
    case 'branch':
      return `M ${x1} ${y1} C ${x1 + bend / 2} ${y1}, ${x1 + bend / 2} ${y2}, ${x1 + bend} ${y2} L ${x2} ${y2}`;
    case 'merge':
      return `M ${x1} ${y1} L ${x2 - bend} ${y1} C ${x2 - bend / 2} ${y1}, ${x2 - bend / 2} ${y2}, ${x2} ${y2}`;
    default: {
      // Level at both ends; a backwards link (see routeEdge) bends the other way.
      const half = x2 > x1 ? (x2 - x1) / 2 : -COLUMN_WIDTH * 0.6;
      return `M ${x1} ${y1} C ${x1 + half} ${y1}, ${x2 - half} ${y2}, ${x2} ${y2}`;
    }
  }
}

const shortLabel = (label: string) =>
  label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label;

function laneHref(lane: PricingGraphLane, versionId?: string) {
  const params = new URLSearchParams();
  if (lane.collectionSlug) params.set('collection', lane.collectionSlug);
  if (versionId) params.set('version', versionId);
  const query = params.toString();
  return `/pricings/${lane.organization.id}/${lane.slug}${query ? `?${query}` : ''}`;
}

/**
 * The versions of a pricing drawn like a commit graph: its lane, and above it the
 * lane of the pricing it was forked from, with a branch from that version to its
 * first one. The forks made of it are not drawn. Quiet stretches of long
 * histories fold into "+N" gaps the viewer can open.
 */
export default function PricingVersionGraph({
  organizationId,
  slug,
  refreshKey,
  currentVersionId,
  onSelectVersion,
}: PricingVersionGraphProps) {
  const { getPricingGraph } = usePricingsApi();
  const router = useRouter();
  const [graph, setGraph] = useState<PricingGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The version pointed at, whose links stand out like the picked one's.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string> | 'all'>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // The version whose changes are shown in a card, and where the card goes.
  const [card, setCard] = useState<{ key: string; left: number; top: number } | null>(null);
  const [viewWidth, setViewWidth] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getPricingGraph(organizationId, slug, controller.signal)
      .then(setGraph)
      .catch(err => {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      });
    return () => controller.abort();
  }, [getPricingGraph, organizationId, slug, refreshKey]);

  // The version on the page and the one picked always stay in view, never folded away.
  const currentPricing = graph?.lanes.find(lane => lane.role === 'current');
  const shownVersion = currentPricing?.versions.find(version => version.id === currentVersionId);
  const shownKey =
    currentPricing && shownVersion ? nodeKey(currentPricing.pricingId, shownVersion.version) : null;
  const small =
    (graph?.lanes ?? []).reduce((count, lane) => count + lane.versions.length, 0) < FOLD_FROM;
  const layout = useMemo(
    () =>
      graph
        ? layoutGraph(graph, {
            expanded: small ? 'all' : expanded,
            keep: new Set([shownKey, selectedKey].filter((key): key is string => !!key)),
          })
        : null,
    [graph, small, expanded, shownKey, selectedKey]
  );
  const currentLaneIndex = layout?.lanes.findIndex(lane => lane.role === 'current') ?? -1;
  const currentLane = layout?.lanes[currentLaneIndex] ?? null;

  // The version shown on the page is picked until the viewer picks another dot.
  const selected =
    layout?.nodes.find(node => node.key === selectedKey) ??
    layout?.nodes.find(node => node.key === shownKey) ??
    null;

  // What the pointed version changed: compared with the version before it, or
  // with the one it was forked from. Versions the viewer cannot read have no card.
  const cardNode = card ? (layout?.nodes.find(node => node.key === card.key) ?? null) : null;
  const cardLane = cardNode && layout ? layout.lanes[cardNode.lane] : null;
  const cardBase =
    graph && cardNode && cardLane ? baseVersionOf(graph, cardLane.pricingId, cardNode.version.version) : null;
  const changesTarget = useMemo<ChangesTarget | null>(
    () =>
      cardNode && cardLane?.available && cardNode.version.yaml
        ? { key: cardNode.key, before: cardBase?.version.yaml ?? null, after: cardNode.version.yaml }
        : null,
    [cardNode, cardLane, cardBase]
  );
  const changes = useVersionChanges(changesTarget);

  // The drawing fills the width it is given, however few versions there are. The
  // scroll area only exists once there is something to draw.
  const drawn = layout !== null;
  useEffect(() => {
    const area = scrollRef.current;
    if (!area) return;
    const observer = new ResizeObserver(() => setViewWidth(area.clientWidth));
    observer.observe(area);
    return () => observer.disconnect();
  }, [drawn]);

  // Open on the version the page shows, centred in both directions (or on the
  // newest versions, on the right). Only when the graph or that version changes:
  // opening a gap must not move the view.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => {
    const area = scrollRef.current;
    const current = layoutRef.current;
    if (!area || !current) return;
    const labels = labelsRef.current?.offsetWidth ?? 0;
    const laneIndex = current.lanes.findIndex(lane => lane.role === 'current');
    const shown = current.nodes.find(node => node.key === shownKey);
    area.scrollLeft = shown ? x(shown.column) - (area.clientWidth - labels) / 2 : area.scrollWidth;
    area.scrollTop = laneIndex * LANE_HEIGHT - (area.clientHeight - LANE_HEIGHT) / 2;
  }, [graph, shownKey]);

  if (error) {
    return (
      <section className="rounded-xl border border-tp-hairline bg-tp-canvas px-4 py-3 text-xs text-tp-steel">
        Could not draw the version graph: {error}
      </section>
    );
  }
  if (!graph || !layout || !currentLane) {
    return (
      <section
        className="h-40 animate-pulse rounded-xl border border-tp-hairline bg-tp-surface"
        aria-label="Loading the version graph"
      />
    );
  }

  const labelsWidth = labelsRef.current?.offsetWidth ?? 0;
  const width = Math.max(x(layout.columns - 1) + PAD_X, viewWidth - labelsWidth, 240);
  const height = layout.lanes.length * LANE_HEIGHT;
  const totalVersions = graph.lanes.reduce((count, lane) => count + lane.versions.length, 0);
  const foldedVersions = layout.gaps.reduce((count, gap) => count + gap.versions.length, 0);

  // While the viewer picks a version, its own branches stand out and the rest step
  // back; the version the page shows is marked, but dims nothing.
  const focus = selectedKey ? selected : null;
  const related = (node: GraphNode) =>
    !focus ||
    node === focus ||
    layout.edges.some(
      edge => (edge.from === focus && edge.to === node) || (edge.to === focus && edge.from === node)
    );
  const selectedLane = selected ? layout.lanes[selected.lane] : null;
  const parentOfSelected = selected
    ? (layout.edges.find(edge => edge.to === selected)?.from ?? null)
    : null;
  const openNode = (node: GraphNode) => {
    const lane = layout.lanes[node.lane];
    if (lane.role === 'current') onSelectVersion(node.version.id);
    else if (lane.available) router.push(laneHref(lane, node.version.id));
  };

  // The card sits under the dot, kept inside the graph's width.
  const showCard = (node: GraphNode, dot: Element) => {
    const area = sectionRef.current?.getBoundingClientRect();
    const box = dot.getBoundingClientRect();
    if (!area) return;
    const half = 148;
    const centre = box.left + box.width / 2 - area.left;
    setCard({
      key: node.key,
      left: Math.min(Math.max(centre, half), Math.max(area.width - half, half)),
      top: box.bottom - area.top + 6,
    });
  };
  const hideCard = (key: string) => setCard(current => (current?.key === key ? null : current));

  const openGap = (key: string) =>
    setExpanded(current => (current === 'all' ? current : new Set(current).add(key)));

  const toolButton =
    'cursor-pointer rounded-lg border border-tp-hairline-strong px-2.5 py-1 text-[11px] font-medium text-tp-ink transition-colors hover:border-tp-primary/40';

  return (
    <section
      ref={sectionRef}
      className="relative rounded-xl border border-tp-hairline bg-tp-canvas"
      aria-label="Version graph"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-tp-hairline px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-tp-ink">Version graph</h3>
          <p className="text-xs text-tp-steel">
            {graph.lanes.length === 1
              ? `${totalVersions} versions, in the order they were released.`
              : `${totalVersions} versions. A branch joins the pricing it was forked from to its first version.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ul
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tp-steel"
            aria-label="Legend"
          >
            {(['source', 'current'] as const).map(role => (
              <li key={role} className="flex items-center gap-1.5">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${ROLE_COLORS[role].dot}`}
                  aria-hidden="true"
                />
                {ROLE_LABEL[role]}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full border-2 border-tp-steel"
                aria-hidden="true"
              />
              Private
            </li>
          </ul>
          {!small && (foldedVersions > 0 || expanded === 'all') && (
            <button
              type="button"
              onClick={() => setExpanded(current => (current === 'all' ? new Set() : 'all'))}
              className={toolButton}
            >
              {expanded === 'all'
                ? 'Fold quiet versions'
                : `Show all versions (+${foldedVersions})`}
            </button>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={() => setCard(null)}
        className="max-h-[26rem] overflow-auto overscroll-contain"
      >
        <div className="flex w-max min-w-full">
          <ul
            ref={labelsRef}
            className="sticky left-0 z-10 w-28 shrink-0 border-r border-tp-hairline bg-tp-canvas sm:w-48"
          >
            {layout.lanes.map(lane => {
              const isCurrent = lane.role === 'current';
              const body = (
                <>
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-tp-steel">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${ROLE_COLORS[lane.role].dot}`}
                      aria-hidden="true"
                    />
                    {ROLE_LABEL[lane.role]}
                  </span>
                  <span
                    className="block truncate text-sm font-medium text-tp-ink"
                    title={lane.name}
                  >
                    {lane.name}
                  </span>
                  <span
                    className="block truncate text-[11px] text-tp-steel"
                    title={lane.organization.displayName}
                  >
                    {lane.available
                      ? lane.organization.displayName
                      : `${lane.organization.displayName} · not visible to you`}
                  </span>
                </>
              );
              return (
                <li key={lane.pricingId} style={{ height: LANE_HEIGHT }} className="bg-tp-canvas">
                  <div
                    className={`flex h-full flex-col justify-center px-3 ${isCurrent ? 'bg-tp-primary/5' : ''}`}
                  >
                    {!isCurrent && lane.available ? (
                      <button
                        type="button"
                        onClick={() => router.push(laneHref(lane))}
                        title={`Open ${lane.name}`}
                        className="min-w-0 cursor-pointer text-left hover:[&>span:nth-child(2)]:underline"
                      >
                        {body}
                      </button>
                    ) : (
                      body
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <svg
            width={width}
            height={height}
            className="shrink-0"
            role="img"
            aria-label={`${layout.nodes.length} versions in ${layout.lanes.length} pricings`}
          >
            {layout.lanes.map((lane, index) => {
              const laneNodes = layout.nodes.filter(node => node.lane === index);
              const first = laneNodes[0];
              const last = laneNodes[laneNodes.length - 1];
              return (
                <g key={lane.pricingId}>
                  {lane.role === 'current' && (
                    <rect
                      x={0}
                      y={index * LANE_HEIGHT}
                      width={width}
                      height={LANE_HEIGHT}
                      className="fill-tp-primary/5"
                    />
                  )}
                  <line
                    x1={0}
                    y1={y(index)}
                    x2={width}
                    y2={y(index)}
                    className="stroke-tp-hairline"
                    strokeWidth={1}
                  />
                  {first && last && first !== last && (
                    <line
                      x1={x(first.column)}
                      y1={y(index)}
                      x2={x(last.column)}
                      y2={y(index)}
                      className={ROLE_COLORS[lane.role].rail}
                      strokeWidth={3}
                      strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })}

            {layout.edges
              .map(edge => ({ edge, long: isLongLink(edge, layout) }))
              // Long links underneath, so the short branches read on top of them.
              .sort((a, b) => Number(b.long) - Number(a.long))
              .map(({ edge, long }) => {
                const d = edgePath(edge, layout);
                const touches = (key: string | null | undefined) =>
                  !!key && (edge.from.key === key || edge.to.key === key);
                const highlighted = touches(selected?.key) || touches(hoveredKey);
                const dimmed = !!focus && edge.from !== focus && edge.to !== focus;
                const quiet = long && !highlighted;
                return (
                  <g
                    key={`${edge.from.key}>${edge.to.key}`}
                    className={`transition-opacity duration-200 ${
                      dimmed && !touches(hoveredKey)
                        ? 'opacity-25'
                        : quiet
                          ? 'opacity-40'
                          : 'opacity-100'
                    }`}
                  >
                    {/* A gap in what it crosses, so the branch reads above the lanes. */}
                    <path
                      d={d}
                      fill="none"
                      className="stroke-tp-canvas"
                      strokeWidth={quiet ? 4 : 7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={d}
                      fill="none"
                      className={ROLE_COLORS[layout.lanes[edge.to.lane].role].stroke}
                      strokeWidth={highlighted ? 3 : quiet ? 1.5 : 2.25}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                );
              })}

            {layout.gaps.map(gap => {
              const cx = (x(gap.afterColumn) + x(gap.beforeColumn)) / 2;
              const cy = y(gap.lane);
              const label = `+${gap.versions.length}`;
              const pillWidth = 14 + label.length * 6.5;
              const names = gap.versions.map(version => version.version);
              return (
                <g
                  key={gap.key}
                  role="button"
                  tabIndex={0}
                  aria-label={`Show ${gap.versions.length} more versions of ${layout.lanes[gap.lane].name}`}
                  onClick={() => openGap(gap.key)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openGap(gap.key);
                    }
                  }}
                  className={`group/gap cursor-pointer outline-none transition-opacity duration-200 ${focus ? 'opacity-55' : 'opacity-100'}`}
                >
                  <title>
                    {`${gap.versions.length} more versions: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}`}
                  </title>
                  <rect
                    x={cx - pillWidth / 2}
                    y={cy - 9}
                    width={pillWidth}
                    height={18}
                    rx={9}
                    className={`fill-tp-canvas ${ROLE_COLORS[layout.lanes[gap.lane].role].rail} group-hover/gap:fill-tp-surface group-focus-visible/gap:stroke-tp-primary`}
                    strokeWidth={1.5}
                  />
                  <text
                    x={cx}
                    y={cy + 3.5}
                    textAnchor="middle"
                    className="fill-tp-slate font-mono text-[10px] font-semibold"
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {layout.nodes.map(node => {
              const lane = layout.lanes[node.lane];
              const color = ROLE_COLORS[lane.role];
              const isSelected = node === selected;
              const filled = lane.available && !node.version.private;
              const cx = x(node.column);
              const cy = y(node.lane);
              const date = node.version.createdAt
                ? format(parseISO(node.version.createdAt), 'PP')
                : 'date not visible';
              return (
                <g
                  key={node.key}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${lane.name} ${node.version.version}, ${date}${node.version.private ? ', private' : ''}`}
                  onClick={() => setSelectedKey(node.key)}
                  onMouseEnter={event => {
                    setHoveredKey(node.key);
                    showCard(node, event.currentTarget);
                  }}
                  onMouseLeave={() => {
                    setHoveredKey(current => (current === node.key ? null : current));
                    hideCard(node.key);
                  }}
                  onFocus={event => {
                    setHoveredKey(node.key);
                    showCard(node, event.currentTarget);
                  }}
                  onBlur={() => {
                    setHoveredKey(current => (current === node.key ? null : current));
                    hideCard(node.key);
                  }}
                  onDoubleClick={() => openNode(node)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedKey(node.key);
                    }
                  }}
                  className={`group/dot cursor-pointer outline-none transition-opacity duration-200 ${related(node) ? 'opacity-100' : 'opacity-55'}`}
                >
                  {/* Readable versions get the card instead of the browser's tooltip. */}
                  {!lane.available && <title>{`${lane.name} ${node.version.version} · ${date}`}</title>}
                  {/* Hit area and selection ring. */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={DOT_RADIUS + 6}
                    className={
                      isSelected
                        ? `${color.soft} ${color.stroke}`
                        : 'fill-transparent stroke-transparent group-hover/dot:fill-tp-hairline/60 group-focus-visible/dot:stroke-tp-primary'
                    }
                    strokeWidth={1.5}
                  />
                  {/* A halo the lines stop at. */}
                  <circle cx={cx} cy={cy} r={DOT_RADIUS + 2.5} className="fill-tp-canvas" />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={filled ? DOT_RADIUS : DOT_RADIUS - 1}
                    className={
                      filled
                        ? `${color.fill} ${color.stroke}`
                        : lane.available
                          ? `fill-tp-canvas ${color.stroke}`
                          : 'fill-tp-canvas stroke-tp-stone'
                    }
                    strokeWidth={filled ? 0 : 2}
                    strokeDasharray={lane.available ? undefined : '2.5 2'}
                  />
                  <text
                    x={cx}
                    y={cy + 25}
                    textAnchor="middle"
                    className={`font-mono text-[11px] ${isSelected ? 'fill-tp-ink font-semibold' : 'fill-tp-steel'}`}
                  >
                    {shortLabel(node.version.version)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {card && cardNode && cardLane && changesTarget && (
        <ChangeSummaryCard
          pricingName={cardLane.name}
          version={cardNode.version.version}
          createdAt={cardNode.version.createdAt}
          firstVersion={!cardBase}
          heading={
            cardBase
              ? `Changes since ${cardBase.version.version}${cardBase.lane.pricingId === cardLane.pricingId ? '' : ` in ${cardBase.lane.name}`}`
              : cardNode.version.forkedFrom
                ? 'Forked from a version you cannot read: what it starts with'
                : 'First version: what it starts with'
          }
          state={changes}
          left={card.left}
          top={card.top}
        />
      )}

      {graph.truncated && (
        <p className="border-t border-tp-hairline px-4 py-2 text-[11px] text-tp-steel">
          Only the first 20 pricings it came from are drawn.
        </p>
      )}

      {selected && selectedLane && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-tp-hairline px-4 py-3">
          <div className="min-w-0 text-xs text-tp-steel">
            <p className="flex flex-wrap items-center gap-2 text-sm text-tp-ink">
              <span className="font-medium">{selectedLane.name}</span>
              <span className="break-all font-mono">{selected.version.version}</span>
              {selected.version.private && (
                <span className="rounded-full bg-tp-surface px-2 py-0.5 text-[10px] font-medium text-tp-steel">
                  Private
                </span>
              )}
              {selected.key === shownKey && (
                <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[10px] font-medium text-tp-primary">
                  Shown
                </span>
              )}
            </p>
            <p className="mt-0.5">
              {selected.version.createdAt
                ? format(parseISO(selected.version.createdAt), 'PPp')
                : 'Its date is not visible to you'}
              {selected.version.addedAt && (
                <> · added to SPHERE {format(parseISO(selected.version.addedAt), 'PPpp')}</>
              )}
              {parentOfSelected && (
                <>
                  {' '}
                  · forked from {layout.lanes[parentOfSelected.lane].name}{' '}
                  <span className="font-mono">{parentOfSelected.version.version}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedLane.available && selected.key !== shownKey && (
              <button
                type="button"
                onClick={() => openNode(selected)}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:border-tp-primary/40"
              >
                {selected.lane === currentLaneIndex
                  ? 'Show this version'
                  : `Open in ${selectedLane.name}`}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
