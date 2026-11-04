import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRICING_LOAD_STARTED,
  afterNextPaint,
  markParsed,
  markShown,
  pricingLoadStatus,
  type EditorView,
} from '../src/modules/pricing-editor/services/pricing-loading.ts';

const YAML = 'saasName: Test\n';

const view = (overrides: Partial<EditorView> = {}): EditorView => ({
  editorValue: YAML,
  lintedValue: YAML,
  codeEditorValue: YAML,
  visual: false,
  ...overrides,
});

const ready = markParsed(markShown(PRICING_LOAD_STARTED));

test('no load in progress is done', () => {
  assert.equal(pricingLoadStatus(null, view({ lintedValue: null, codeEditorValue: null })), 'done');
});

test('a load is in progress until its YAML is shown and parsed', () => {
  const empty = view({ editorValue: '', lintedValue: '', codeEditorValue: '' });

  assert.equal(pricingLoadStatus(PRICING_LOAD_STARTED, empty), 'loading');
  assert.equal(pricingLoadStatus(markShown(PRICING_LOAD_STARTED), view()), 'loading');
  assert.equal(pricingLoadStatus(ready, view()), 'done');
});

test('a load waits for the linter to have gone through the YAML', () => {
  assert.equal(pricingLoadStatus(ready, view({ lintedValue: null })), 'loading');
  assert.equal(pricingLoadStatus(ready, view({ lintedValue: '' })), 'loading');
  assert.equal(pricingLoadStatus(ready, view({ lintedValue: YAML })), 'done');
});

test('a load waits for Monaco to show the YAML, unless the visual editor is open', () => {
  assert.equal(pricingLoadStatus(ready, view({ codeEditorValue: null })), 'waiting-for-editor');
  assert.equal(pricingLoadStatus(ready, view({ codeEditorValue: '' })), 'waiting-for-editor');
  assert.equal(pricingLoadStatus(ready, view({ codeEditorValue: null, visual: true })), 'done');
});

test('an empty pricing finishes too', () => {
  const empty = view({ editorValue: '', lintedValue: '', codeEditorValue: '' });

  assert.equal(pricingLoadStatus(ready, empty), 'done');
});

test('a load that fails before it has any YAML is over; one that fails parsing waits for the rest', () => {
  assert.equal(markParsed(PRICING_LOAD_STARTED), null);
  assert.deepEqual(markParsed(markShown(PRICING_LOAD_STARTED)), { shown: true, parsed: true });
  assert.equal(markParsed(null), null);
  assert.equal(markShown(null), null);
});

test('afterNextPaint resolves after the frame callback, from a task scheduled in it', async () => {
  const events: string[] = [];
  let frame: (() => void) | undefined;
  let task: (() => void) | undefined;

  const done = afterNextPaint(
    callback => {
      events.push('frame requested');
      frame = callback;
    },
    callback => {
      events.push('task scheduled');
      task = callback;
    }
  ).then(() => events.push('resolved'));

  await Promise.resolve();
  assert.deepEqual(events, ['frame requested']);

  frame!();
  await Promise.resolve();
  assert.deepEqual(events, ['frame requested', 'task scheduled']);

  task!();
  await done;
  assert.deepEqual(events, ['frame requested', 'task scheduled', 'resolved']);
});
