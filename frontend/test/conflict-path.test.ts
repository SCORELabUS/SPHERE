import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatConflictPath } from '../src/modules/core/utils/pricing-merge-resolver.ts';

test('paths are labelled as the server labels them', () => {
  assert.equal(formatConflictPath(['plans', 'PRO.v2', 'price']), 'plans["PRO.v2"].price');
  assert.equal(formatConflictPath(['features', 'sso', 'valueType']), 'features.sso.valueType');
  assert.equal(formatConflictPath(['plans', 'Pro plan']), 'plans["Pro plan"]');
  assert.equal(formatConflictPath(['1st']), '["1st"]');
});
