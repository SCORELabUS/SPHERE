import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baseVersionOf, layoutGraph, nodeKey, routeEdge } from '../src/modules/pricing/utils/version-graph.ts';
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
    yaml: createdAt ? `/static/${pricingId}/${version}.yml` : null,
    addedAt: null,
    private: false,
    forkedFrom: origin ? { pricingId: origin[0], version: origin[1] } : null,
  })),
});

const month = (n: number) => new Date(Date.UTC(2024, n, 1)).toISOString();

test('puts the pricing it was forked from above it, with versions in release order', () => {
  const graph: PricingGraph = {
    pricingId: 'personal',
    truncated: false,
    lanes: [
      lane('personal', 'current', [
        ['1.2.0', '2026-03-01T00:00:00Z'],
        ['1.1.0', '2026-02-01T00:00:00Z', ['original', '1.1.0']],
      ]),
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
    ['source', 'current']
  );
  assert.deepEqual(
    layout.nodes.map(node => `${layout.lanes[node.lane].pricingId} ${node.version.version}`),
    ['original 1.0.0', 'original 1.1.0', 'personal 1.1.0', 'personal 1.2.0', 'original 2.0.0']
  );
  assert.deepEqual(
    layout.edges.map(edge => `${edge.from.version.id} > ${edge.to.version.id}`),
    ['original-1.1.0 > personal-1.1.0']
  );
  // The fork's first version is where its lane starts: the branch bends off its origin.
  assert.equal(routeEdge(layout.edges[0], layout), 'branch');
});

test('places a version of an unreadable source right before what was forked from it', () => {
  const layout = layoutGraph({
    pricingId: 'personal',
    truncated: false,
    lanes: [
      lane('personal', 'current', [
        ['1.0.0', '2026-01-01T00:00:00Z', ['hidden', '2024']],
        ['1.1.0', '2026-03-01T00:00:00Z'],
      ]),
      lane('hidden', 'source', [['2024', null]], false),
    ],
  });

  assert.deepEqual(
    layout.nodes.map(node => node.version.version),
    ['2024', '1.0.0', '1.1.0']
  );
  assert.equal(layout.edges.length, 1);
});

test('folds quiet stretches into gaps, keeps branch ends and kept versions, and opens on request', () => {
  const graph: PricingGraph = {
    pricingId: 'main',
    truncated: false,
    lanes: [
      lane('main', 'current', [['0.1.0', month(6).replace('01T', '02T'), ['origin', '1.6.0']]]),
      lane(
        'origin',
        'source',
        Array.from({ length: 12 }, (_, i) => [`1.${i}.0`, month(i)] as [string, string])
      ),
    ],
  };

  const folded = layoutGraph(graph, { keep: new Set([nodeKey('origin', '1.9.0')]) });
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

test('routes links of older data, whose later versions name origins, as curves or merges', () => {
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

test('compares a version with the one before it, or with the one it was forked from', () => {
  const graph: PricingGraph = {
    pricingId: 'personal',
    truncated: false,
    lanes: [
      lane('personal', 'current', [
        ['1.2.0', month(5)],
        ['1.1.0', month(3), ['original', '1.0.0']],
      ]),
      lane('original', 'source', [
        ['1.0.0', month(1)],
        ['0.9.0', month(0)],
      ]),
    ],
  };
  const base = (pricingId: string, version: string) => {
    const found = baseVersionOf(graph, pricingId, version);
    return found && `${found.lane.pricingId} ${found.version.version}`;
  };
  assert.equal(base('personal', '1.2.0'), 'personal 1.1.0');
  assert.equal(base('personal', '1.1.0'), 'original 1.0.0');
  assert.equal(base('original', '1.0.0'), 'original 0.9.0');
  assert.equal(base('original', '0.9.0'), null);

  // Insertion order wins even when release dates and ids say the reverse.
  const versions = graph.lanes[0].versions;
  versions[0].createdAt = month(0);
  versions[0].addedAt = '2026-11-06T10:00:03Z';
  versions[0].id = 'first-id';
  versions[1].createdAt = month(10);
  versions[1].addedAt = '2026-11-06T10:00:01Z';
  versions[1].id = 'last-id';
  assert.equal(base('personal', '1.2.0'), 'personal 1.1.0');

  // An origin the viewer cannot read gives nothing to compare with.
  const hidden = { ...graph, lanes: [graph.lanes[0], lane('original', 'source', [['1.0.0', null]], false)] };
  assert.equal(baseVersionOf(hidden, 'personal', '1.1.0'), null);
});

test('orders versions by addedAt even when release dates disagree', () => {
  const sameDay = '2026-03-01T00:00:00Z';
  const current = lane('personal', 'current', [
    // Listed newest first, as the API sends them; the dates tie.
    ['b', sameDay],
    ['a', sameDay],
    ['first', month(0)],
  ]);
  current.versions[0].addedAt = '2026-11-06T10:00:05.000Z';
  current.versions[1].addedAt = '2026-11-06T10:00:01.000Z';
  // The release dates disagree with insertion order and must not win.
  current.versions[0].createdAt = '2025-01-01T00:00:00Z';
  current.versions[1].createdAt = '2026-02-01T00:00:00Z';
  const layout = layoutGraph({ pricingId: 'personal', truncated: false, lanes: [current] });
  assert.deepEqual(
    layout.nodes.map(node => node.version.version),
    ['first', 'a', 'b']
  );

  // Swapping when they were added swaps them, whatever order they arrive in.
  current.versions[0].addedAt = '2026-11-06T10:00:01.000Z';
  current.versions[1].addedAt = '2026-11-06T10:00:05.000Z';
  assert.deepEqual(
    layoutGraph({ pricingId: 'personal', truncated: false, lanes: [current] }).nodes.map(node => node.version.version),
    ['first', 'b', 'a']
  );
});
