const assert = require('node:assert/strict');
const test = require('node:test');
const { plan, providerId, sourceRecord, validateSources } = require('./migrate-scoretech-users.cjs');

const issuer = 'https://identity.example.invalid/realms/score';
const email = 'member@example.invalid';
const google = { provider: 'google', providerId: 'google-subject', email, emailVerified: true };
const us = { provider: 'us-sso', providerId: 'uvus', email: 'uvus@alum.us.es' };
const source = sourceRecord({ _id: '100000000000000000000001', email, identities: [google, us] });
const existing = { id: 'identity-subject', username: 'member', email, enabled: true, emailVerified: true };
const links = source.identities.map((identity) => ({ identityProvider: identity.provider, userId: identity.providerId }));

function fixture(users, federated = {}) {
  return { async admin(endpoint) {
    const url = new URL(endpoint, issuer);
    if (url.pathname === '/users') {
      const alias = url.searchParams.get('idpAlias');
      return alias ? users.filter((user) => federated[user.id]?.some((link) =>
        link.identityProvider === alias && link.userId === url.searchParams.get('idpUserId'))) : users;
    }
    return federated[url.pathname.split('/')[2]] ?? [];
  } };
}

test('plans new email and broker users, and reuses a user with both stable provider IDs', async () => {
  const newAccounts = await plan(fixture([]), { issuer, sources: [source] });
  assert.deepEqual(newAccounts.conflicts, []);
  assert.equal(newAccounts.entries[0].target, undefined);
  const matched = await plan(fixture([existing], { [existing.id]: links }), { issuer, sources: [source] });
  assert.deepEqual(matched.conflicts, []);
  assert.equal(matched.entries[0].target, existing);
});

test('does not attach a missing provider to an existing user based on email', async () => {
  const result = await plan(fixture([existing]), { issuer, sources: [source] });
  assert.match(result.conflicts[0], /missing a SPHERE provider link/);
  assert.deepEqual(result.entries, []);
});

test('a verified matching mailbox is eligible for an email account and an unverified one is not', async () => {
  const sources = [{ ...source, identities: [] }];
  assert.equal((await plan(fixture([existing]), { issuer, sources })).entries[0].target, existing);
  const unverified = await plan(fixture([{ ...existing, emailVerified: false }]), { issuer, sources });
  assert.match(unverified.conflicts[0], /no verified ownership/);
});

test('rejects a broker subject that conflicts with a prior SCORETech link', async () => {
  const linked = { ...existing, id: 'linked-subject' };
  const sources = [{ ...source, identities: [...source.identities, {
    provider: 'scoretech', providerId: providerId(issuer, linked.id),
  }] }];
  const result = await plan(fixture([existing, { ...linked, email: 'linked@example.invalid' }], {
    [existing.id]: links,
  }), { issuer, sources });
  assert.match(result.conflicts[0], /point to different users/);
});

test('flags generated CAS addresses and refuses duplicate source identities', () => {
  assert.equal(sourceRecord({ _id: source.id, email: us.email, identities: [us] }).guessedEmail, true);
  assert.equal(sourceRecord({ _id: source.id, email: us.email, emailVerifiedAt: new Date(), identities: [us] }).guessedEmail, false);
  assert.throws(() => validateSources([source, { ...source, id: '100000000000000000000002', email: 'other@example.invalid' }]), /Duplicate sign-in identity/);
});
