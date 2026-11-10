import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareVersionsOldestFirst } from '../src/modules/pricing/utils/version-order.ts';

// Buffer as it was seeded: every version added in the same second, with ids that do not follow the dates.
const buffer = [
  { id: '687e3ca4102baa50f3a5c53a', version: '2019-11-29', createdAt: '2019-11-29T00:00:00.000Z' },
  { id: '687e3ca4102baa50f3a5c539', version: '2024-07-02', createdAt: '2024-07-02T00:00:00.000Z' },
  { id: '687e3ca4102baa50f3a5c538', version: '2020-11-29', createdAt: '2020-11-29T00:00:00.000Z' },
  { id: '687e3ca4102baa50f3a5c537', version: '2021-11-29', createdAt: '2021-11-29T00:00:00.000Z' },
  { id: '687e3ca4102baa50f3a5c536', version: '2023-11-29', createdAt: '2023-11-29T00:00:00.000Z' },
  { id: '687e3ca4102baa50f3a5c535', version: '2022-11-29', createdAt: '2022-11-29T00:00:00.000Z' },
].map(version => ({ ...version, addedAt: '2025-07-21T13:12:04.000Z' }));

test('orders versions oldest first by release date, whatever their ids say', () => {
  const ordered = [...buffer].sort(compareVersionsOldestFirst);
  assert.deepEqual(
    ordered.map(version => version.version),
    ['2019-11-29', '2020-11-29', '2021-11-29', '2022-11-29', '2023-11-29', '2024-07-02']
  );
  // "Compare versions" pairs a version with the one released right before it.
  const index = ordered.findIndex(version => version.version === '2024-07-02');
  assert.equal(ordered[index - 1].version, '2023-11-29');
});

test('orders versions released at the same instant by when SPHERE received them, then by id', () => {
  const day = '2026-03-01T00:00:00.000Z';
  const later = { id: 'a', createdAt: day, addedAt: '2026-11-06T10:00:05.000Z' };
  const earlier = { id: 'z', createdAt: day, addedAt: '2026-11-06T10:00:01.000Z' };
  const sameA = { id: 'b', createdAt: day, addedAt: '2026-11-06T10:00:09.000Z' };
  const sameB = { id: 'c', createdAt: day, addedAt: '2026-11-06T10:00:09.000Z' };
  assert.deepEqual(
    [sameB, later, sameA, earlier].sort(compareVersionsOldestFirst).map(version => version.id),
    ['z', 'a', 'b', 'c']
  );
});

test('puts versions without a readable release date first, as the oldest', () => {
  const unknown = { id: 'x', createdAt: null, addedAt: '2026-11-09T00:00:00.000Z' };
  const known = { id: 'y', createdAt: '2019-01-01T00:00:00.000Z', addedAt: null };
  assert.deepEqual([known, unknown].sort(compareVersionsOldestFirst).map(version => version.id), ['x', 'y']);
});
