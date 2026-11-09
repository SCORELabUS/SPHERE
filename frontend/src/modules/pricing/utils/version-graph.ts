import { compareVersionsOldestFirst, versionInstant } from './version-order.ts';
import type { PricingGraph, PricingGraphLane, PricingGraphVersion } from '../types/graph';

// The layout of a version graph, drawn like a commit graph turned on its side:
// one horizontal lane per pricing, one column per version in release order, and
// a branch from the origin of a fork to its first version. Only where a pricing
// came from is drawn (the lane of its origin above it), never the forks made of it.
//
// Long histories stay readable: a run of versions of one lane that no branch
// starts or ends at folds into one "+N" gap, which the viewer can open.

export interface GraphNode {
  key: string;
  lane: number;
  column: number;
  version: PricingGraphVersion;
}

export interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
}

/** Versions of a lane hidden between two shown ones. */
export interface GraphGap {
  key: string;
  lane: number;
  /** The shown versions of the lane around it. */
  afterColumn: number;
  beforeColumn: number;
  versions: PricingGraphVersion[];
}

export interface GraphLayout {
  /** The pricing it came from first, then the pricing shown. */
  lanes: PricingGraphLane[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  gaps: GraphGap[];
  columns: number;
}

export interface LayoutOptions {
  /** Gaps opened by the viewer (by key), or every version shown. */
  expanded?: ReadonlySet<string> | 'all';
  /** Nodes that must stay visible (the version on the page, the one picked), by key. */
  keep?: ReadonlySet<string>;
}

export const nodeKey = (pricingId: string, version: string) => `${pricingId}\u0000${version}`;

interface Entry {
  key: string;
  pricingId: string;
  version: PricingGraphVersion;
  /** When it was released (createdAt); NaN until an unreadable origin gets one. */
  time: number;
  /** When SPHERE received it, which orders versions released at the same instant. */
  added: number;
}

const compare = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/** When it was released, then when SPHERE received it. */
const byInstant = (a: Entry, b: Entry) => compare(a.time, b.time) || compare(a.added, b.added);

/** Release order (as `compareVersionsOldestFirst`), with the instant given to an unreadable origin. */
const byRelease = (a: Entry, b: Entry) => byInstant(a, b) || a.version.id.localeCompare(b.version.id);

export function layoutGraph(graph: PricingGraph, options: LayoutOptions = {}): GraphLayout {
  const { expanded = new Set<string>(), keep = new Set<string>() } = options;

  // Every version with the instant it was released and the instant SPHERE received it.
  // One whose date is unknown (a source the viewer cannot read) goes right before the
  // first version forked from it.
  const all: Entry[] = graph.lanes.flatMap(lane =>
    lane.versions.map(version => ({
      key: nodeKey(lane.pricingId, version.version),
      pricingId: lane.pricingId,
      version,
      time: version.createdAt ? Date.parse(version.createdAt) : NaN,
      added: versionInstant(version.addedAt),
    }))
  );
  const children = new Map<string, Entry[]>();
  for (const entry of all) {
    const origin = entry.version.forkedFrom;
    if (!origin) continue;
    const key = nodeKey(origin.pricingId, origin.version);
    children.set(key, [...(children.get(key) ?? []), entry]);
  }
  for (const entry of all) {
    if (!Number.isNaN(entry.time)) continue;
    const known = (children.get(entry.key) ?? [])
      .map(child => child.time)
      .filter(t => !Number.isNaN(t));
    entry.time = known.length ? Math.min(...known) - 1 : Number.NEGATIVE_INFINITY;
  }
  const byKey = new Map(all.map(entry => [entry.key, entry]));
  const entriesOf = (lane: PricingGraphLane) =>
    lane.versions.map(version => byKey.get(nodeKey(lane.pricingId, version.version))!);

  // Origins above the pricing shown: a fork has one. Older data, whose later
  // versions may name origins too, puts the most recently linked one closest.
  const current = graph.lanes.find(lane => lane.role === 'current');
  const linkTime = (lane: PricingGraphLane) => {
    const times = (current ? entriesOf(current) : [])
      .filter(entry => entry.version.forkedFrom?.pricingId === lane.pricingId)
      .map(entry => entry.time);
    return times.length ? Math.max(...times) : Number.NEGATIVE_INFINITY;
  };
  const sources = graph.lanes
    .filter(lane => lane.role === 'source')
    .sort((a, b) => linkTime(a) - linkTime(b));
  const lanes = [...sources, ...(current ? [current] : [])];
  const laneOf = new Map(lanes.map((lane, index) => [lane.pricingId, index]));

  // The versions that must be seen: where a branch starts or ends, each lane's
  // first and last, and those the caller keeps.
  const visibleEntries = all.filter(entry => laneOf.has(entry.pricingId));
  const linked = new Set<string>();
  for (const entry of visibleEntries) {
    const origin = entry.version.forkedFrom;
    if (!origin || !laneOf.has(origin.pricingId)) continue;
    const originKey = nodeKey(origin.pricingId, origin.version);
    if (!byKey.has(originKey)) continue;
    linked.add(entry.key);
    linked.add(originKey);
  }

  const hidden = new Set<string>();
  const gapRuns: { key: string; lane: number; entries: Entry[] }[] = [];
  lanes.forEach((lane, laneIndex) => {
    const ordered = entriesOf(lane).sort(byRelease);
    let run: Entry[] = [];
    const close = () => {
      if (!run.length) return;
      const key = `${lane.pricingId}\u0000${run[0].version.version}`;
      // A single quiet version is not worth a gap of its own.
      if (expanded !== 'all' && !expanded.has(key) && run.length > 1) {
        run.forEach(entry => hidden.add(entry.key));
        gapRuns.push({ key, lane: laneIndex, entries: run });
      }
      run = [];
    };
    ordered.forEach((entry, index) => {
      const quiet =
        index > 0 && index < ordered.length - 1 && !linked.has(entry.key) && !keep.has(entry.key);
      if (quiet) run.push(entry);
      else close();
    });
    close();
  });

  const ordered = visibleEntries
    .filter(entry => !hidden.has(entry.key))
    .sort(
      (a, b) =>
        byInstant(a, b) ||
        laneOf.get(a.pricingId)! - laneOf.get(b.pricingId)! ||
        a.version.id.localeCompare(b.version.id)
    );
  const nodes: GraphNode[] = ordered.map((entry, column) => ({
    key: entry.key,
    lane: laneOf.get(entry.pricingId)!,
    column,
    version: entry.version,
  }));
  const nodeByKey = new Map(nodes.map(node => [node.key, node]));

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    const origin = node.version.forkedFrom;
    const from = origin && nodeByKey.get(nodeKey(origin.pricingId, origin.version));
    if (from) edges.push({ from, to: node });
  }

  // A gap sits between the shown versions of its lane right before and after it.
  const gaps: GraphGap[] = gapRuns.map(run => {
    const laneNodes = nodes.filter(node => node.lane === run.lane);
    const first = run.entries[0];
    const last = run.entries[run.entries.length - 1];
    const before = [...laneNodes].reverse().find(node => byRelease(byKey.get(node.key)!, first) <= 0);
    const after = laneNodes.find(node => byRelease(byKey.get(node.key)!, last) >= 0);
    return {
      key: run.key,
      lane: run.lane,
      afterColumn: before?.column ?? 0,
      beforeColumn: after?.column ?? nodes.length - 1,
      versions: run.entries.map(entry => entry.version),
    };
  });

  return {
    lanes,
    nodes,
    edges,
    gaps,
    columns: nodes.length,
  };
}

/**
 * How a branch is drawn: when its target lane starts with it, it bends down
 * right after its origin and runs along that lane (a fork branching off); when
 * its origin lane ends with it and the target is close, it runs along that lane
 * and bends down right before its target (merging in); otherwise one S-curve
 * between them. A long run along a lane would read as part of that lane, so a
 * distant merge is a curve too.
 */
export function routeEdge(edge: GraphEdge, layout: GraphLayout): 'branch' | 'merge' | 'curve' {
  // A version dated before its origin (dates can be edited) runs backwards: one curve.
  if (edge.to.column <= edge.from.column) return 'curve';
  const laneNodes = (lane: number) => layout.nodes.filter(node => node.lane === lane);
  const targetFirst = laneNodes(edge.to.lane)[0];
  if (targetFirst === edge.to) return 'branch';
  const sourceNodes = laneNodes(edge.from.lane);
  if (sourceNodes[sourceNodes.length - 1] === edge.from && edge.to.column - edge.from.column <= 2) {
    return 'merge';
  }
  return 'curve';
}

/** Columns a curve may span before it counts as a long link. */
export const LONG_LINK_COLUMNS = 3;

/**
 * A link between distant versions of two lanes (an old version of an origin
 * brought into a much later one). It crosses everything in between, so it is
 * drawn thin and quiet until one of its ends is picked or pointed at.
 */
export function isLongLink(edge: GraphEdge, layout: GraphLayout): boolean {
  return (
    routeEdge(edge, layout) !== 'branch' &&
    Math.abs(edge.to.column - edge.from.column) > LONG_LINK_COLUMNS
  );
}

/** A version found by pricing and label, with its lane. */
export interface VersionRef {
  lane: PricingGraphLane;
  version: PricingGraphVersion;
}

/**
 * The version to compare a version with, to say what it changed: the one it was
 * forked from when it names one, otherwise the version of its own lane released
 * right before it. Null for the first version of a pricing, or when that version
 * is not one the viewer can read.
 */
export function baseVersionOf(graph: PricingGraph, pricingId: string, label: string): VersionRef | null {
  const lane = graph.lanes.find(candidate => candidate.pricingId === pricingId);
  const version = lane?.versions.find(candidate => candidate.version === label);
  if (!lane || !version) return null;

  const origin = version.forkedFrom;
  if (origin) {
    const originLane = graph.lanes.find(candidate => candidate.pricingId === origin.pricingId);
    const originVersion = originLane?.versions.find(candidate => candidate.version === origin.version);
    return originLane?.available && originVersion?.yaml ? { lane: originLane, version: originVersion } : null;
  }

  const ordered = [...lane.versions].sort(compareVersionsOldestFirst);
  const before = ordered[ordered.indexOf(version) - 1];
  return before?.yaml ? { lane, version: before } : null;
}
