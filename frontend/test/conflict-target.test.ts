import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  conflictTarget,
  formatConflictPath,
  groupConflictsByTarget,
  targetKey,
} from '../src/modules/core/utils/pricing-merge-resolver.ts';
import type { ConflictScope, MergeConflict } from '../src/modules/pricing/types/pull-requests.ts';

const SECTIONS = new Set(['plans', 'features', 'addOns', 'usageLimits']);

function conflict(path: string[], scope: ConflictScope = 'value'): MergeConflict {
  const section = SECTIONS.has(path[0]) ? (path[0] as MergeConflict['section']) : 'general';
  return {
    id: JSON.stringify(path),
    path,
    label: formatConflictPath(path),
    section,
    scope,
    base: { present: true, yaml: 'a\n' },
    current: { present: true, yaml: 'b\n' },
    proposal: { present: true, yaml: 'c\n' },
  };
}

test('a plan value of a feature or a usage limit is a cell of the table (CA-32)', () => {
  assert.deepEqual(conflictTarget(['plans', 'PRO', 'features', 'sso', 'value']), {
    kind: 'cell',
    plan: 'PRO',
    section: 'features',
    name: 'sso',
  });
  assert.deepEqual(conflictTarget(['plans', 'PRO', 'usageLimits', 'seats']), {
    kind: 'cell',
    plan: 'PRO',
    section: 'usageLimits',
    name: 'seats',
  });
  // Plan names with dots stay one segment.
  assert.deepEqual(conflictTarget(['plans', 'PRO.v2', 'features', 'sso', 'value']), {
    kind: 'cell',
    plan: 'PRO.v2',
    section: 'features',
    name: 'sso',
  });
});

test('plan fields go to the plan header, feature and limit fields to their row, add-on fields to its card', () => {
  assert.deepEqual(conflictTarget(['plans', 'PRO']), { kind: 'plan', plan: 'PRO' });
  assert.deepEqual(conflictTarget(['plans', 'PRO', 'price']), { kind: 'plan', plan: 'PRO' });
  assert.deepEqual(conflictTarget(['plans', 'PRO', 'features']), { kind: 'plan', plan: 'PRO' });
  assert.deepEqual(conflictTarget(['features', 'sso', 'valueType']), { kind: 'row', section: 'features', name: 'sso' });
  assert.deepEqual(conflictTarget(['features', 'sso']), { kind: 'row', section: 'features', name: 'sso' });
  assert.deepEqual(conflictTarget(['usageLimits', 'seats', 'linkedFeatures']), {
    kind: 'row',
    section: 'usageLimits',
    name: 'seats',
  });
  assert.deepEqual(conflictTarget(['addOns', 'extraSeats', 'availableFor']), { kind: 'addOn', addOn: 'extraSeats' });
  assert.deepEqual(conflictTarget(['addOns', 'extraSeats', 'usageLimitsExtensions', 'seats', 'value']), {
    kind: 'addOn',
    addOn: 'extraSeats',
  });
});

test('general fields and unknown fields go to "Other fields"; the order of a section to its header (CA-33)', () => {
  for (const path of [
    ['billing'],
    ['billing', 'annual'],
    ['url'],
    ['tags'],
    ['currency'],
    ['custom', 'anything'],
    ['plans', 'PRO', 'unknownField'],
    ['plans', 'PRO', 'features', 'sso', 'note'],
    ['features', 'sso', 'unknownField'],
    ['usageLimits', 'seats', 'unknownField'],
    ['addOns', 'extraSeats', 'unknownField'],
  ]) {
    assert.deepEqual(conflictTarget(path), { kind: 'other' }, formatConflictPath(path));
  }
  // An order conflict names only its section.
  assert.deepEqual(conflictTarget(conflict(['plans'], 'order').path), { kind: 'section', section: 'plans' });
  assert.deepEqual(conflictTarget(['usageLimits']), { kind: 'section', section: 'usageLimits' });
});

test('every conflict is drawn exactly once: the groups add up to the number of conflicts (CA-33)', () => {
  const conflicts = [
    conflict(['plans', 'PRO', 'features', 'sso', 'value']),
    conflict(['plans', 'PRO', 'features', 'sso']),
    conflict(['plans', 'BASIC', 'price']),
    conflict(['features', 'sso', 'description']),
    conflict(['addOns', 'extraSeats', 'price']),
    conflict(['plans'], 'order'),
    conflict(['billing']),
    conflict(['url']),
    conflict(['tags'], 'list'),
    conflict(['plans', 'PRO', 'mystery']),
  ];
  const groups = groupConflictsByTarget(conflicts);
  const drawn = [...groups.values()].flat();
  assert.equal(drawn.length, conflicts.length);
  assert.deepEqual(new Set(drawn.map(item => item.id)), new Set(conflicts.map(item => item.id)));

  // The cell holds both conflicts on PRO × sso; "Other fields" the four the table does not draw.
  assert.equal(groups.get(targetKey({ kind: 'cell', plan: 'PRO', section: 'features', name: 'sso' }))?.length, 2);
  assert.deepEqual(
    groups.get(targetKey({ kind: 'other' }))?.map(item => item.label),
    ['billing', 'url', 'tags', 'plans.PRO.mystery']
  );
  assert.equal(groups.get(targetKey({ kind: 'section', section: 'plans' }))?.[0].scope, 'order');
});

test('paths are labelled as the server labels them', () => {
  assert.equal(formatConflictPath(['plans', 'PRO.v2', 'price']), 'plans["PRO.v2"].price');
  assert.equal(formatConflictPath(['features', 'sso', 'valueType']), 'features.sso.valueType');
  assert.equal(formatConflictPath(['plans', 'Pro plan']), 'plans["Pro plan"]');
  assert.equal(formatConflictPath(['1st']), '["1st"]');
});
