import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  initialResolverState,
  rebaseChoices,
  resolutionsOf,
  resolverReducer,
  unresolvedConflicts,
  type ResolverState,
} from '../src/modules/core/utils/pricing-merge-resolver.ts';
import type { ConflictSide, MergeConflict } from '../src/modules/pricing/types/pull-requests.ts';

const side = (yaml: string | null): ConflictSide => (yaml === null ? { present: false } : { present: true, yaml });

function conflict(path: string[], base: string | null, current: string | null, proposal: string | null): MergeConflict {
  return {
    id: JSON.stringify(path),
    path,
    label: path.join('.'),
    section: 'plans',
    entry: path[1],
    scope: 'value',
    base: side(base),
    current: side(current),
    proposal: side(proposal),
  };
}

const price = conflict(['plans', 'PRO', 'price'], '10\n', '12\n', '15\n');
const description = conflict(['plans', 'PRO', 'description'], 'Pro\n', 'Pro plan\n', 'The pro plan\n');
const legacy = conflict(['plans', 'LEGACY'], 'price: 5\n', null, 'price: 6\n');

function chosen(...steps: Array<[MergeConflict, 'current' | 'proposal']>): ResolverState {
  return steps.reduce(
    (state, [target, choice]) => resolverReducer(state, { type: 'choose', id: target.id, side: choice }),
    initialResolverState([price, description, legacy])
  );
}

test('choices are shared state: counted, sent only for the conflicts of the latest preview', () => {
  const state = chosen([price, 'current'], [legacy, 'proposal']);
  assert.deepEqual(state.choices, { [price.id]: 'current', [legacy.id]: 'proposal' });
  assert.deepEqual(unresolvedConflicts(state).map(item => item.id), [description.id]);
  assert.deepEqual(resolutionsOf(state), { [price.id]: 'current', [legacy.id]: 'proposal' });
  // A side for a conflict the preview does not have is never taken.
  assert.equal(resolverReducer(state, { type: 'choose', id: '["plans","GONE"]', side: 'current' }), state);
});

test('after the preview is computed again, only choices whose three values did not change are kept (CA-14)', () => {
  const state = chosen([price, 'current'], [description, 'proposal'], [legacy, 'proposal']);
  // A newer latest version moved PRO's price from 12 to 14; the description and LEGACY are as they were.
  const movedPrice = conflict(['plans', 'PRO', 'price'], '10\n', '14\n', '15\n');
  const next = resolverReducer(state, { type: 'conflicts-loaded', conflicts: [movedPrice, description, legacy] });
  assert.deepEqual(next.choices, { [description.id]: 'proposal', [legacy.id]: 'proposal' });
  assert.deepEqual(next.changed, [price.id]);
  assert.deepEqual(unresolvedConflicts(next).map(item => item.id), [price.id]);
  assert.equal(price.id in resolutionsOf(next), false);

  // The mark stays while the conflict is as it was, and goes once the user chooses again.
  const again = resolverReducer(next, { type: 'conflicts-loaded', conflicts: [movedPrice, description, legacy] });
  assert.deepEqual(again.changed, [price.id]);
  const rechosen = resolverReducer(again, { type: 'choose', id: price.id, side: 'proposal' });
  assert.deepEqual(rechosen.changed, []);
  assert.equal(rechosen.choices[price.id], 'proposal');
});

test('a choice is dropped when any one of base, current or proposal changed, or the side became absent', () => {
  const previous = { conflicts: [price], choices: { [price.id]: 'proposal' as const }, changed: [] };
  const variants = [
    conflict(['plans', 'PRO', 'price'], '11\n', '12\n', '15\n'),
    conflict(['plans', 'PRO', 'price'], '10\n', '13\n', '15\n'),
    conflict(['plans', 'PRO', 'price'], '10\n', '12\n', '16\n'),
    conflict(['plans', 'PRO', 'price'], '10\n', null, '15\n'),
  ];
  for (const variant of variants) {
    assert.deepEqual(rebaseChoices(previous, [variant]), { choices: {}, changed: [price.id] });
  }
  // The same values: kept. A conflict that is gone takes its choice with it, unmarked.
  assert.deepEqual(rebaseChoices(previous, [{ ...price }]), { choices: { [price.id]: 'proposal' }, changed: [] });
  assert.deepEqual(rebaseChoices(previous, []), { choices: {}, changed: [] });
});

test('a choice is taken at once: the result is never typed by hand, so there is nothing to confirm or discard (CA-35)', () => {
  const state = chosen([price, 'current']);
  const next = resolverReducer(state, { type: 'choose', id: description.id, side: 'proposal' });
  assert.deepEqual(next.choices, { [price.id]: 'current', [description.id]: 'proposal' });
  assert.equal('manualYaml' in next, false);
});

test('Alt+arrows move between conflicts and stop at the ends; a new preview keeps the active one if it is still there', () => {
  let state = initialResolverState([price, description, legacy]);
  assert.equal(state.activeId, price.id);
  state = resolverReducer(state, { type: 'move', step: 1 });
  assert.equal(state.activeId, description.id);
  state = resolverReducer(resolverReducer(state, { type: 'move', step: 1 }), { type: 'move', step: 1 });
  assert.equal(state.activeId, legacy.id);
  state = resolverReducer(state, { type: 'move', step: -1 });
  assert.equal(state.activeId, description.id);
  assert.equal(resolverReducer(state, { type: 'focus', id: 'unknown' }), state);

  const reloaded = resolverReducer(state, { type: 'conflicts-loaded', conflicts: [legacy, description] });
  assert.equal(reloaded.activeId, description.id);
  const gone = resolverReducer(state, { type: 'conflicts-loaded', conflicts: [legacy] });
  assert.equal(gone.activeId, legacy.id);

  const none = initialResolverState();
  assert.equal(none.activeId, null);
  assert.equal(resolverReducer(none, { type: 'move', step: 1 }), none);
  const fromNothing = { ...initialResolverState([price, description, legacy]), activeId: null };
  assert.equal(resolverReducer(fromNothing, { type: 'move', step: -1 }).activeId, legacy.id);
});
