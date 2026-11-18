import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRICING_VISIBILITY_CHOICES,
  anonymousLinkStep,
  changeVisibility,
  isListedWithPublicVersion,
  makePublicConfirmation,
  pricingVisibility,
  publicSwitchWarning,
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
  assert.match(text, /2 anonymous links/);
  assert.match(text, /search/);
  assert.match(text, /organization/);
  assert.match(makePublicConfirmation(1), /1 anonymous link\b/);
});

test('counts every link before making a pricing public, also the suspended ones, and warns when they cannot be read (I2, CA-25.1)', () => {
  // Public makes every version visible, so a link suspended while its version is private serves again.
  const suspended = { active: false };
  const active = { active: true };
  assert.match(publicSwitchWarning([suspended, suspended]) ?? '', /2 anonymous links/);
  assert.match(publicSwitchWarning([active, suspended, suspended]) ?? '', /3 anonymous links/);
  assert.equal(publicSwitchWarning([]), null);
  assert.match(publicSwitchWarning(null) ?? '', /may have anonymous links/);
  // An already listed pricing is not "listed" by it, but its versions become visible next to its organization (N9).
  assert.match(publicSwitchWarning([active], false) ?? '', /makes every version visible in SPHERE's search/);
  assert.doesNotMatch(publicSwitchWarning([active], false) ?? '', /lists it/);
});

/** What the Settings tab asks, in order, and whether it got through. */
async function askedFor(target: 'Public' | 'Unlisted' | 'Private', options: { unlisted: boolean; links?: unknown[] | 'unreadable' | 'none'; answer?: 'confirm' | 'cancel' }) {
  const asked: Array<{ text: string; confirmLabel?: string }> = [];
  let listed = 0;
  // As the API answers: every link of the pricing, suspended or not.
  const listLinks = options.links === 'none' ? undefined : async () => {
    listed += 1;
    if (options.links === 'unreadable') throw new Error('offline');
    return { links: options.links ?? [], limit: 20 };
  };
  const confirm = async (text: string, settings: { confirmLabel?: string }) => {
    asked.push({ text, confirmLabel: settings.confirmLabel });
    if (options.answer === 'cancel') throw new Error('cancelled');
  };
  let applied = 0;
  const changed = await changeVisibility(target, {
    unlisted: options.unlisted, versions: 4, listLinks, confirm, apply: async () => { applied += 1; },
  });
  assert.equal(applied, changed ? 1 : 0);
  return { asked, listed, result: changed ? 'apply' : 'nothing sent' };
}

test('asks once before changing the visibility, about the links when making it public, from every state (I2, N3, CA-25.1, CA-25.2)', async () => {
  const suspended = { active: false };
  // Private (links suspended) and Unlisted to Public: the warning about every link, and only it.
  for (const unlisted of [true, false]) {
    const { asked, listed, result } = await askedFor('Public', { unlisted, links: [suspended, suspended] });
    assert.equal(listed, 1);
    assert.equal(asked.length, 1);
    assert.match(asked[0].text, /2 anonymous links/);
    assert.equal(asked[0].confirmLabel, 'Make public');
    assert.equal(result, 'apply');
  }
  // Links that could not be read still warn.
  assert.match((await askedFor('Public', { unlisted: true, links: 'unreadable' })).asked[0].text, /may have anonymous links/);
  // No links: the usual question, which says it lists the pricing only when it is unlisted (R3).
  const fromUnlisted = await askedFor('Public', { unlisted: true, links: [] });
  assert.deepEqual(fromUnlisted.asked.map(question => question.text), ['Make all 4 versions of this pricing public and list the pricing in search and on its organization\'s page?']);
  const alreadyListed = await askedFor('Public', { unlisted: false, links: [] });
  assert.deepEqual(alreadyListed.asked.map(question => question.text), ['Make all 4 versions of this pricing public?']);
  // A pricing without an id yet has no links to look up (R4).
  const noId = await askedFor('Public', { unlisted: true, links: 'none' });
  assert.equal(noId.listed, 0);
  assert.equal(noId.asked.length, 1);
  assert.doesNotMatch(noId.asked[0].text, /anonymous link/);
  // Other targets never look the links up.
  for (const target of ['Unlisted', 'Private'] as const) {
    const { asked, listed } = await askedFor(target, { unlisted: false, links: [suspended] });
    assert.equal(listed, 0, target);
    assert.equal(asked.length, 1, target);
    assert.doesNotMatch(asked[0].text, /anonymous link/, target);
  }
  // Cancelling sends nothing (CA-25.2).
  assert.equal((await askedFor('Public', { unlisted: true, links: [suspended], answer: 'cancel' })).result, 'nothing sent');
  assert.equal((await askedFor('Private', { unlisted: true, answer: 'cancel' })).result, 'nothing sent');
});
