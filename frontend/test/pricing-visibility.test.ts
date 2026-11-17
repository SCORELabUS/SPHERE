import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRICING_VISIBILITY_CHOICES,
  anonymousLinkStep,
  isListedWithPublicVersion,
  makePublicConfirmation,
  pricingVisibility,
  visibilityChangeBody,
  visibilityFormFields,
} from '../src/modules/core/utils/pricing-visibility.ts';

const visible = { private: false };
const hidden = { private: true };

test('offers Public, Unlisted and Private, in that order', () => {
  assert.deepEqual(PRICING_VISIBILITY_CHOICES, ['Public', 'Unlisted', 'Private']);
});

test('private versions decide first: all of them is Private, some is Mixed, whatever the listing (S1-S3)', () => {
  assert.equal(pricingVisibility([hidden, hidden], false), 'Private');
  assert.equal(pricingVisibility([hidden, hidden], true), 'Private');
  assert.equal(pricingVisibility([visible, hidden], false), 'Mixed');
  assert.equal(pricingVisibility([visible, hidden], true), 'Mixed');
});

test('with no private version the listing decides between Unlisted and Public (S4, S5)', () => {
  assert.equal(pricingVisibility([visible, visible], true), 'Unlisted');
  assert.equal(pricingVisibility([visible, visible], false), 'Public');
  assert.equal(pricingVisibility([], false), 'Public');
});

test('a listed pricing reads as it did before Unlisted existed (CA-7.5)', () => {
  const before = (versions: Array<{ private: boolean }>) => {
    const privateCount = versions.filter(v => v.private).length;
    return privateCount === 0 ? 'Public' : privateCount === versions.length ? 'Private' : 'Mixed';
  };
  const cases = [[], [visible], [hidden], [visible, hidden], [hidden, visible, visible], [hidden, hidden, hidden]];
  for (const versions of cases) assert.equal(pricingVisibility(versions, false), before(versions));
});

test('sends private and unlisted for Public and Unlisted, and keeps the listing for Private', () => {
  assert.deepEqual(visibilityChangeBody('Public'), { private: false, unlisted: false });
  assert.deepEqual(visibilityChangeBody('Unlisted'), { private: false, unlisted: true });
  assert.deepEqual(visibilityChangeBody('Private'), { private: true });
});

test('creates a pricing with the form fields of each choice (CA-2.1)', () => {
  assert.deepEqual(visibilityFormFields('Public'), { private: 'false', unlisted: 'false' });
  assert.deepEqual(visibilityFormFields('Unlisted'), { private: 'false', unlisted: 'true' });
  assert.deepEqual(visibilityFormFields('Private'), { private: 'true', unlisted: 'false' });
});

test('a pricing is listed with something public only when it is not unlisted and has a visible version', () => {
  assert.equal(isListedWithPublicVersion([visible], false), true);
  assert.equal(isListedWithPublicVersion([hidden, visible], false), true);
  assert.equal(isListedWithPublicVersion([visible], true), false);
  assert.equal(isListedWithPublicVersion([hidden], false), false);
});

test('the anonymous link dialog asks about a private version before warning about a listed pricing (D1-D4)', () => {
  assert.equal(anonymousLinkStep(hidden, [hidden, visible], false), 'private-version');
  assert.equal(anonymousLinkStep(visible, [visible], false), 'listed-warning');
  assert.equal(anonymousLinkStep(visible, [visible], true), 'ready');
  assert.equal(anonymousLinkStep(hidden, [hidden], true), 'private-version');
});

test('warns how many anonymous links making the pricing public exposes (CA-25.1)', () => {
  const text = makePublicConfirmation(2);
  assert.match(text, /2 active anonymous links/);
  assert.match(text, /search/);
  assert.match(text, /organization/);
  assert.match(makePublicConfirmation(1), /1 active anonymous link\b/);
});
