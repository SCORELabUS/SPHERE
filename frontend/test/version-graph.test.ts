import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  layoutGraph,
  nodeKey,
  routeEdge,
  suggestVersionName,
} from '../src/modules/pricing/utils/version-graph.ts';
import type { PricingGraph, PricingGraphLane } from '../src/modules/pricing/types/graph.ts';

const lane = (
  pricingId: string,
  role: PricingGraphLane['role'],
  versions: Array<[string, string | null, [string, string]?]>,
  available = true
): PricingGraphLane => ({
  pricingId,
  name: pricingId,
  slug: pricingId,
  organization: { id: `org-${pricingId}`, name: pricingId, displayName: pricingId },
  collectionSlug: null,
  role,
  available,
  versions: versions.map(([version, createdAt, origin]) => ({
    id: `${pricingId}-${version}`,
    version,
    createdAt,
    private: false,
    forkedFrom: origin ? { pricingId: origin[0], version: origin[1] } : null,
  })),
});

test('puts sources above the pricing and forks below it, with versions in release order', () => {
  const graph: PricingGraph = {
    pricingId: 'personal',
    truncated: false,
    lanes: [
      lane('personal', 'current', [
        ['1.2.0', '2026-03-01T00:00:00Z'],
        ['1.1.0', '2026-02-01T00:00:00Z', ['original', '1.1.0']],
      ]),
      lane('copy', 'fork', [['1.2.0', '2026-04-01T00:00:00Z', ['personal', '1.2.0']]]),
      lane('original', 'source', [
        ['2.0.0', '2026-05-01T00:00:00Z'],
        ['1.1.0', '2026-01-15T00:00:00Z'],
        ['1.0.0', '2026-01-01T00:00:00Z'],
      ]),
    ],
  };

  const layout = layoutGraph(graph);

  assert.deepEqual(
    layout.lanes.map(l => l.role),
    ['source', 'current', 'fork']
  );
  assert.deepEqual(
    layout.nodes.map(node => `${layout.lanes[node.lane].pricingId} ${node.version.version}`),
    [
      'original 1.0.0',
      'original 1.1.0',
      'personal 1.1.0',
      'personal 1.2.0',
      'copy 1.2.0',
      'original 2.0.0',
    ]
  );
  assert.deepEqual(
    layout.nodes.map(node => node.column),
    [0, 1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    layout.edges.map(edge => `${edge.from.version.id} > ${edge.to.version.id}`),
    ['original-1.1.0 > personal-1.1.0', 'personal-1.2.0 > copy-1.2.0']
  );
});

test('places a version of an unreadable source right before what was forked from it', () => {
  const layout = layoutGraph({
    pricingId: 'personal',
    truncated: false,
    lanes: [
      lane('personal', 'current', [
        ['0.5.0', '2026-01-01T00:00:00Z'],
        ['1.0.0', '2026-03-01T00:00:00Z', ['hidden', '2024']],
      ]),
      lane('hidden', 'source', [['2024', null]], false),
    ],
  });

  assert.deepEqual(
    layout.nodes.map(node => node.version.version),
    ['0.5.0', '2024', '1.0.0']
  );
  assert.equal(layout.edges.length, 1);
});

test('suggests the next minor version, skipping names already taken', () => {
  assert.equal(suggestVersionName(['0.5.0', '1.0.0', '1.1.0'], '1.1.0'), '1.2.0');
  assert.equal(suggestVersionName(['1.0.0', '1.0.1', '1.1.0', '1.1.1', '2.0.0'], '2.0.0'), '2.1.0');
  assert.equal(suggestVersionName(['2.0.0', '2.1.0'], '9.9.9'), '2.2.0');
  assert.equal(suggestVersionName(['2024-07-02'], '2023'), '2023');
  assert.equal(suggestVersionName(['2023'], '2023'), '2023-fork');
});

const month = (n: number) => new Date(Date.UTC(2024, n, 1)).toISOString();

test('folds quiet stretches into gaps, keeps branch ends and kept versions, and opens on request', () => {
  const versions: Array<[string, string | null, [string, string]?]> = Array.from(
    { length: 12 },
    (_, i) => [`1.${i}.0`, month(i)]
  );
  const graph: PricingGraph = {
    pricingId: 'main',
    truncated: false,
    lanes: [
      lane('main', 'current', versions),
      lane('fork', 'fork', [['0.1.0', month(6).replace('01T', '02T'), ['main', '1.6.0']]]),
    ],
  };

  const folded = layoutGraph(graph, { keep: new Set([nodeKey('main', '1.9.0')]) });
  assert.deepEqual(
    folded.nodes.filter(node => node.lane === 0).map(node => node.version.version),
    ['1.0.0', '1.6.0', '1.9.0', '1.10.0', '1.11.0']
  );
  assert.deepEqual(
    folded.gaps.map(gap => gap.versions.map(v => v.version).join(' ')),
    ['1.1.0 1.2.0 1.3.0 1.4.0 1.5.0', '1.7.0 1.8.0']
  );
  // A single quiet version (1.10.0) is not worth a gap.
  assert.ok(folded.nodes.some(node => node.version.version === '1.10.0'));
  assert.equal(folded.edges.length, 1);

  const opened = layoutGraph(graph, { expanded: new Set([folded.gaps[0].key]) });
  assert.equal(opened.gaps.length, 1);
  assert.equal(layoutGraph(graph, { expanded: 'all' }).nodes.length, 13);
});

test('puts the most recent forks closest to the pricing and leaves out those past the limit', () => {
  const graph: PricingGraph = {
    pricingId: 'main',
    truncated: false,
    lanes: [
      lane(
        'main',
        'current',
        Array.from({ length: 5 }, (_, i) => [`${i}.0.0`, month(i * 2)] as [string, string])
      ),
      ...[0, 1, 2, 3].map(i =>
        lane(`fork${i}`, 'fork', [[`f${i}`, month(i * 2 + 1), ['main', `${i}.0.0`]]])
      ),
    ],
  };

  const layout = layoutGraph(graph, { forkLimit: 2 });
  assert.deepEqual(
    layout.lanes.map(l => l.pricingId),
    ['main', 'fork3', 'fork2']
  );
  assert.equal(layout.hiddenForks, 2);
  // A fork's lane starts with its branch, which bends off its origin and runs along it.
  assert.ok(layout.edges.every(edge => routeEdge(edge, layout) === 'branch'));
});

test('routes a version brought into a pricing that already had versions as a curve or a merge', () => {
  const layout = layoutGraph({
    pricingId: 'personal',
    truncated: false,
    lanes: [
      lane('personal', 'current', [
        ['0.5.0', month(0)],
        ['1.2.0', month(6), ['original', '1.1.0']],
        ['1.3.0', month(7), ['ended', '9.0.0']],
      ]),
      lane('original', 'source', [
        ['1.1.0', month(3)],
        ['2.0.0', month(9)],
      ]),
      lane('ended', 'source', [['9.0.0', month(4)]]),
    ],
  });
  const into = (pricingId: string) =>
    layout.edges.find(edge => layout.lanes[edge.from.lane].pricingId === pricingId)!;
  // The original goes on after 1.1.0: one curve between the two lanes.
  assert.equal(routeEdge(into('original'), layout), 'curve');
  // Nothing came after 9.0.0: the branch runs along its lane and bends down at the end.
  assert.equal(routeEdge(into('ended'), layout), 'merge');
});
