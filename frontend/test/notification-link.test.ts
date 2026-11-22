import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notificationLink } from '../src/modules/notification/utils/notification-link.ts';

const PRICING_ID = '6650f0c0c0c0c0c0c0c0c001';
const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';

test('a pull request notification opens the pull request through the pricing permanent link', () => {
  const link = notificationLink({
    kind: 'PricingPullRequest',
    data: { pricingId: PRICING_ID, pullRequestId: PR_ID, number: 3, organizationId: 'org-1', pricingSlug: 'demo' },
  });
  // By pricing id, not by slug: the link survives renames and collection moves.
  assert.equal(link, `/p/${PRICING_ID}?tab=pull-requests&pr=${PR_ID}`);
});

test('a pull request notification without its ids leads nowhere', () => {
  assert.equal(notificationLink({ kind: 'PricingPullRequest', data: { pricingId: PRICING_ID } }), null);
  assert.equal(notificationLink({ kind: 'PricingPullRequest', data: { pullRequestId: PR_ID } }), null);
  assert.equal(notificationLink({ kind: 'PricingPullRequest' }), null);
});

test('the other kinds keep their links (CA-68)', () => {
  assert.equal(
    notificationLink({ kind: 'OrganizationInvitation', data: { invitationCode: 'abc' } }),
    '/orgs/join/abc'
  );
  assert.equal(
    notificationLink({ kind: 'PricingUpdated', data: { organizationId: 'org-1', pricingSlug: 'demo' } }),
    '/pricings/org-1/demo'
  );
  assert.equal(notificationLink({ kind: 'PricingUpdated', data: { organizationId: 'org-1' } }), null);
  assert.equal(notificationLink({ kind: 'System', data: {} }), null);
  assert.equal(notificationLink({ kind: 'CollectionShared', data: { organizationId: 'org-1' } }), null);
});
