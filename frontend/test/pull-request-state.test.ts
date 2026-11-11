import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canProposeFromEditor,
  describePullRequestState,
  pullRequestMessage,
} from '../src/modules/core/utils/pull-request-state.ts';
import type { PullRequestState } from '../src/modules/pricing/types/pull-requests.ts';

const latest = { id: '6650f0c0c0c0c0c0c0c0c002', version: '2.0' };

test('the editor proposes only when it was opened on the latest public version, by id (CA-21)', () => {
  assert.equal(canProposeFromEditor({ versionId: latest.id }, latest), true);
  // Another version, a private one newer than the latest public included.
  assert.equal(canProposeFromEditor({ versionId: '6650f0c0c0c0c0c0c0c0c003' }, latest), false);
  // No latest public version: nothing to propose to.
  assert.equal(canProposeFromEditor({ versionId: latest.id }, null), false);
});

test('a recreated label or the editor fallback to the newest version never enables proposing (CA-87)', () => {
  // The same label "2.0", deleted and created again with another id.
  const recreated = { versionId: '6650f0c0c0c0c0c0c0c0c009', version: latest.version };
  assert.equal(canProposeFromEditor(recreated, latest), false);
  // Opened from `?source=` without a version id: the editor falls back to versions[0].
  assert.equal(canProposeFromEditor({}, latest), false);
  assert.equal(canProposeFromEditor({ versionId: null }, latest), false);
  assert.equal(canProposeFromEditor(null, latest), false);
});

test('each state has its own text, icon and tone', () => {
  const view = (state: PullRequestState, merged?: { at: string; version?: string }) =>
    describePullRequestState({ state, merged });
  assert.deepEqual(view({ kind: 'merged' }, { at: '2026-11-11T10:00:00Z', version: '3.0' }), {
    label: 'Merged as 3.0',
    icon: 'merged',
    tone: 'success',
  });
  // A merged version the viewer may not read is not named.
  assert.equal(view({ kind: 'merged' }, { at: '2026-11-11T10:00:00Z' }).label, 'Merged');
  assert.equal(view({ kind: 'closed' }).label, 'Closed');
  assert.equal(view({ kind: 'no-public-version' }).label, 'No public version');
  assert.equal(view({ kind: 'up-to-date' }).label, 'Up to date');
  assert.equal(view({ kind: 'no-changes' }).label, 'No changes');
  assert.deepEqual(view({ kind: 'behind', conflicts: 0 }), { label: 'Behind · can merge', icon: 'can-merge', tone: 'info' });
  assert.equal(view({ kind: 'behind', conflicts: 1 }).label, 'Behind · 1 conflict');
  assert.deepEqual(view({ kind: 'behind', conflicts: 3 }), { label: 'Behind · 3 conflicts', icon: 'conflicts', tone: 'warning' });

  const kinds: PullRequestState[] = [
    { kind: 'merged' },
    { kind: 'closed' },
    { kind: 'no-public-version' },
    { kind: 'up-to-date' },
    { kind: 'no-changes' },
    { kind: 'behind', conflicts: 0 },
    { kind: 'behind', conflicts: 2 },
  ];
  const icons = kinds.map(state => view(state).icon);
  assert.equal(new Set(icons).size, kinds.length);
});

test('error codes and reasons not to propose have their own message, with the details they carry', () => {
  assert.equal(
    pullRequestMessage('BASE_NOT_LATEST', { message: 'There is a newer public version', latest: { version: '4.0' } }),
    'A newer public version (4.0) was published. Proposals start from the latest public version.'
  );
  assert.equal(pullRequestMessage('PULL_REQUEST_EXISTS', { number: 7 }), 'Pull request #7 is already open');
  assert.equal(
    pullRequestMessage('NO_CHANGES'),
    'Nothing to propose: the proposal is the same as the latest public version.'
  );
  assert.match(pullRequestMessage('PULL_REQUEST_MERGING'), /being merged/);
  assert.match(pullRequestMessage('NO_PUBLIC_VERSION'), /no public version/);

  // The parser's text is what tells the author what to fix.
  const parser = 'The feature Unauthorized not found is linked but does not exist';
  assert.equal(pullRequestMessage('INVALID_PRICING', { message: parser }), parser);
  assert.equal(pullRequestMessage('INVALID_PRICING'), 'The pricing is not valid.');

  // A fork whose parent was deleted and one whose parent the caller cannot read read the same.
  assert.equal(pullRequestMessage('PARENT_UNAVAILABLE'), 'The pricing this fork comes from is not available.');

  // Who is not a maintainer only gets the generic limit.
  assert.notEqual(pullRequestMessage('LIMIT_REACHED'), pullRequestMessage('PRICING_LIMIT'));

  // An unknown code, or none, shows the server's message.
  assert.equal(pullRequestMessage('SOMETHING_NEW', { message: 'From the server' }), 'From the server');
  assert.equal(pullRequestMessage(undefined, { message: 'Too many requests' }), 'Too many requests');
  assert.match(pullRequestMessage(undefined), /Something went wrong/);
  // Inherited object keys are not codes.
  assert.equal(pullRequestMessage('toString', { message: 'From the server' }), 'From the server');
});
