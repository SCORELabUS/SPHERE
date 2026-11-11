const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const aliases = ['google', 'us-sso'];
const marker = 'scoreSphereMigrationId';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (email) => (email ?? '').trim().toLowerCase();
const importUsername = (id) => `sphere-migration-${id}`;
// Keep in sync with ScoretechIdentityService.scoretechIdentityId.
const providerId = (issuer, subject) => createHash('sha256').update(JSON.stringify([issuer, subject])).digest('hex');
const write = (data) => process.stdout.write(`${JSON.stringify(data)}\n`);
const read = () => JSON.parse(readFileSync(0, 'utf8'));
const path = encodeURIComponent;

class MigrationError extends Error {}
class MigrationConflict extends MigrationError {}
function check(condition, message) {
  if (!condition) throw new MigrationError(message);
}
function requireMatch(condition, message) {
  if (!condition) throw new MigrationConflict(message);
}

function sourceRecord(user) {
  const email = normalizeEmail(user.email);
  const identities = (user.identities ?? []).map(({ provider, providerId, email, emailVerified }) => ({
    provider, providerId, email: normalizeEmail(email), emailVerified: emailVerified === true,
  }));
  const us = identities.find((identity) => identity.provider === 'us-sso');
  // Legacy CAS generated this address when no mailbox was supplied. A ticket proves the UVUS,
  // not ownership of the generated mailbox. Give that account an undeliverable address instead.
  const guessedEmail = us && !user.emailVerifiedAt && email === normalizeEmail(`${us.providerId}@alum.us.es`) &&
    !identities.some((identity) => identity.provider === 'google' && identity.emailVerified && identity.email === email);
  return {
    id: String(user._id), email, firstName: user.firstName, lastName: user.lastName, identities,
    guessedEmail: Boolean(guessedEmail),
  };
}

const loginEmail = (source) => source.guessedEmail ? `${importUsername(source.id)}@example.invalid` : source.email;
const brokerLinks = (source) => source.identities.filter((identity) => aliases.includes(identity.provider));
const currentLink = (source) => source.identities.find((identity) => identity.provider === 'scoretech');

function validateSources(sources) {
  const seenEmails = new Set();
  const seenIdentities = new Set();
  for (const source of sources) {
    check(/^[a-f0-9]{24}$/.test(source.id), 'Unexpected SPHERE user ID.');
    check(source.email.length <= 254 && emailPattern.test(source.email), `Invalid email on SPHERE user ${source.id}.`);
    check(!seenEmails.has(source.email), `Duplicate SPHERE email on user ${source.id}.`);
    seenEmails.add(source.email);
    const providers = new Set();
    for (const identity of source.identities) {
      check([...aliases, 'scoretech'].includes(identity.provider) &&
        typeof identity.providerId === 'string' && identity.providerId.trim() && identity.providerId.length <= 255 &&
        !providers.has(identity.provider), `Invalid or ambiguous sign-in method on SPHERE user ${source.id}.`);
      providers.add(identity.provider);
      const key = JSON.stringify([identity.provider, identity.providerId]);
      check(!seenIdentities.has(key), `Duplicate sign-in identity on SPHERE user ${source.id}.`);
      seenIdentities.add(key);
    }
  }
}

async function withSphere(work) {
  check((process.env.AUTH_PROVIDER || 'local') === 'local', 'Keep SPHERE in local sign-in mode while migrating.');
  const { default: mongoose } = await import('mongoose');
  const moduleUrl = pathToFileURL(resolve('dist/main/config/mongoose.js'));
  const { getMongoDBConnectionURI } = await import(moduleUrl.href);
  const configUrl = pathToFileURL(resolve('dist/main/services/scoretech/config.js'));
  const { scoretechConfig } = await import(configUrl.href);
  let config;
  try { config = scoretechConfig(); } catch {
    throw new MigrationError('Complete SPHERE’s SCORETech Identity client configuration before migrating.');
  }
  await mongoose.connect(getMongoDBConnectionURI(), { serverSelectionTimeoutMS: 10000 });
  try {
    const users = mongoose.connection.db.collection('users');
    const rows = await users.find({}, {
      projection: { email: 1, firstName: 1, lastName: 1, emailVerifiedAt: 1, identities: 1 },
      sort: { _id: 1 },
    }).toArray();
    const sources = rows.map(sourceRecord);
    validateSources(sources);
    await work({ issuer: config.issuer, clientId: config.clientId, sources }, users, rows);
  } finally {
    await mongoose.disconnect();
  }
}

async function link() {
  const { snapshot, targets } = read();
  await withSphere(async (current, users, rows) => {
    check(JSON.stringify(current) === JSON.stringify(snapshot), 'SPHERE accounts changed during provisioning. Rerun the migration before switching sign-in.');
    check(targets.length === rows.length && new Set(targets.map((target) => target.subject)).size === rows.length &&
      targets.every((target) => typeof target.subject === 'string' && target.subject.length > 0), 'Invalid mapping from SCORETech Identity.');
    let linked = 0;
    for (const [index, row] of rows.entries()) {
      const target = targets[index];
      const source = current.sources[index];
      const id = providerId(current.issuer, target.subject);
      if (currentLink(source)) {
        check(currentLink(source).providerId === id, `SPHERE user ${source.id} is linked to a different account.`);
        continue;
      }
      const identity = {
        provider: 'scoretech', providerId: id, email: target.email,
        emailVerified: target.emailVerified === true, linkedAt: new Date(),
      };
      const result = await users.updateOne({
        _id: row._id, email: row.email, identities: row.identities === undefined ? { $exists: false } : row.identities,
      }, { $set: { identities: [...(row.identities ?? []), identity] } });
      check(result.modifiedCount === 1, `SPHERE user ${source.id} changed. Rerun the migration before switching sign-in.`);
      linked++;
    }
    console.log(`SPHERE links created: ${linked}. Total accounts linked: ${rows.length}.`);
  });
}

function keycloak(env) {
  const issuer = env.APP_KEYCLOAK_ISSUER;
  const realm = env.APP_KEYCLOAK_REALM;
  const transport = env.APP_KEYCLOAK_TRANSPORT_URL;
  const admin = `${env.APP_KEYCLOAK_ADMIN_URL}/admin/realms/${path(realm)}`;
  const secret = env.APP_KEYCLOAK_ADMIN_CLIENT_SECRET_FILE
    ? readFileSync(env.APP_KEYCLOAK_ADMIN_CLIENT_SECRET_FILE, 'utf8').trim()
    : env.APP_KEYCLOAK_ADMIN_CLIENT_SECRET;
  check(issuer && realm && transport && secret && env.APP_KEYCLOAK_ADMIN_CLIENT_ID === 'identity-admin-service',
    'Run the migration in the SCORETech Identity admin-api container.');
  let token;
  let refreshAt = 0;
  async function request(url, label, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new MigrationError(`Unable to contact Keycloak for ${label}.`); }
    check(response.ok, `Keycloak ${label} returned HTTP ${response.status}.`);
    return response;
  }
  async function call(endpoint, label, body) {
    if (Date.now() >= refreshAt) {
      const response = await request(`${transport}/protocol/openid-connect/token`, 'service authentication', {
        method: 'POST', body: new URLSearchParams({
          grant_type: 'client_credentials', client_id: env.APP_KEYCLOAK_ADMIN_CLIENT_ID, client_secret: secret,
        }),
      });
      const grant = await response.json();
      token = grant.access_token;
      refreshAt = Date.now() + Math.max(0, grant.expires_in - 15) * 1000;
    }
    const headers = { authorization: `Bearer ${token}` };
    if (body === undefined) return (await request(endpoint, label, { headers })).json();
    await request(endpoint, label, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  return {
    issuer,
    admin: (endpoint, label, body) => call(admin + endpoint, label, body),
    catalogue: () => call(`${transport}/score-catalogue`, 'role catalogue'),
  };
}

async function targetUsers(kc) {
  const users = [];
  for (let first = 0; ; first += 100) {
    const page = await kc.admin(`/users?first=${first}&max=100`, 'users');
    users.push(...page);
    if (page.length < 100) return users;
  }
}

async function plan(kc, { issuer, sources }) {
  const users = await targetUsers(kc);
  const byBinding = new Map(users.map((user) => [providerId(issuer, user.id), user]));
  const claimed = new Set();
  const conflicts = [];
  const entries = [];
  for (const source of sources) {
    try {
      const email = loginEmail(source);
      const emailMatches = users.filter((user) => normalizeEmail(user.email) === email);
      const imported = users.filter((user) => user.username === importUsername(source.id));
      requireMatch(emailMatches.length <= 1 && imported.length <= 1 &&
        imported.every((user) => user.attributes?.[marker]?.[0] === source.id), 'Duplicate or unexpected destination account.');
      const linked = currentLink(source) && byBinding.get(currentLink(source).providerId);
      requireMatch(!currentLink(source) || linked, 'The existing SCORETech link does not belong to a user in this realm.');
      const brokerOwners = [];
      for (const identity of brokerLinks(source)) {
        const query = new URLSearchParams({ idpAlias: identity.provider, idpUserId: identity.providerId, max: '2' });
        const owners = await kc.admin(`/users?${query}`, 'federated identity lookup');
        requireMatch(owners.length <= 1, 'The same provider identity belongs to multiple SCORETech users.');
        brokerOwners.push(...owners);
      }
      const trusted = [linked, ...imported, ...brokerOwners].filter(Boolean);
      requireMatch(new Set(trusted.map((user) => user.id)).size <= 1, 'The existing SCORETech link and provider IDs point to different users.');
      const target = trusted[0] ?? emailMatches[0];
      if (target) {
        requireMatch(target.enabled && !target.username.startsWith('service-account-'), 'The matching SCORETech account is disabled or reserved.');
        requireMatch(emailPattern.test(normalizeEmail(target.email)), 'The matching SCORETech account needs a valid email.');
        requireMatch(trusted.length || (!source.guessedEmail && target.emailVerified), 'The matching SCORETech mailbox has no verified ownership or known link.');
        requireMatch(!claimed.has(target.id), 'Multiple SPHERE users would share this SCORETech account.');
        requireMatch(linked || (normalizeEmail(target.email) === email && emailMatches[0]?.id === target.id), 'The matching provider account uses a different email.');
        const federated = await kc.admin(`/users/${path(target.id)}/federated-identity`, 'linked provider lookup');
        requireMatch(brokerLinks(source).every((identity) => federated.some((item) =>
          item.identityProvider === identity.provider && item.userId === identity.providerId)), 'The existing SCORETech user is missing a SPHERE provider link. Review and link it before retrying.');
        claimed.add(target.id);
      }
      entries.push({ source, target });
    } catch (error) {
      if (!(error instanceof MigrationConflict)) throw error;
      conflicts.push(`${source.id}: ${error.message}`);
    }
  }
  return { entries, conflicts };
}

async function provision(apply) {
  const snapshot = read();
  const { issuer, clientId, sources } = snapshot;
  const kc = keycloak(process.env);
  check(issuer === kc.issuer, 'SPHERE and the destination SCORETech Identity realm use different public issuers.');
  validateSources(sources);
  const { catalogue } = await kc.catalogue();
  const registrationRole = catalogue.roles.find((role) => role.name === catalogue.defaultRole);
  check(registrationRole && registrationRole.name !== 'administrador', 'Configure a regular default registration role in SCORETech Identity.');
  const required = catalogue.accessRules.find((rule) => rule.clientId === clientId)?.requiredPermissions ?? [];
  check(required.every((permission) => registrationRole.permissions.includes(permission)), 'The SCORETech default role does not grant the permissions required by the SPHERE client.');
  const nativeRole = await kc.admin(`/roles/${path(registrationRole.name)}`, 'default role');
  const { entries, conflicts } = await plan(kc, snapshot);
  console.error(`SPHERE accounts: ${sources.length}. Create: ${entries.filter((entry) => !entry.target).length}. Reuse: ${entries.filter((entry) => entry.target).length}. Conflicts: ${conflicts.length}.`);
  console.error(`Google: ${sources.filter((source) => brokerLinks(source).some((identity) => identity.provider === 'google')).length}. US: ${sources.filter((source) => brokerLinks(source).some((identity) => identity.provider === 'us-sso')).length}. US generated addresses: ${sources.filter((source) => source.guessedEmail).length}.`);
  for (const conflict of conflicts) console.error(conflict);
  check(!conflicts.length, 'Resolve the conflicts before applying the migration.');
  if (!apply) return;

  const targets = [];
  for (const { source, target } of entries) {
    let user = target;
    if (!user) {
      const email = loginEmail(source);
      const username = importUsername(source.id);
      await kc.admin('/users', `user creation for ${source.id}`, {
        username, email, emailVerified: false, enabled: true,
        firstName: source.firstName || 'SPHERE', lastName: source.lastName || 'Member',
        attributes: { [marker]: [source.id] },
        federatedIdentities: brokerLinks(source).map((identity) => ({
          identityProvider: identity.provider, userId: identity.providerId, userName: identity.email || identity.providerId,
        })),
      });
      [user] = await kc.admin(`/users?${new URLSearchParams({ username, exact: 'true' })}`, `new user lookup for ${source.id}`);
      check(user?.attributes?.[marker]?.[0] === source.id && normalizeEmail(user.email) === email, `Could not verify the new SCORETech user for ${source.id}.`);
      const federated = await kc.admin(`/users/${path(user.id)}/federated-identity`, 'new user provider lookup');
      check(brokerLinks(source).every((identity) => federated.some((item) =>
        item.identityProvider === identity.provider && item.userId === identity.providerId)), `Could not verify the new provider links for ${source.id}.`);
    }
    const rolePath = `/users/${path(user.id)}/role-mappings/realm`;
    const effective = await kc.admin(`${rolePath}/composite`, 'current user roles');
    const hasDefault = effective.some((role) => role.name === nativeRole.name || role.name === 'administrador');
    const needsDefault = registrationRole.permissions.some((permission) => !effective.some((role) => role.name === permission));
    if (!hasDefault && (!target || user.attributes?.[marker]?.[0] === source.id || needsDefault)) {
      await kc.admin(rolePath, `default role assignment for ${source.id}`, [{ id: nativeRole.id, name: nativeRole.name }]);
      const assigned = await kc.admin(`${rolePath}/composite`, 'assigned user roles');
      check(assigned.some((role) => role.name === nativeRole.name), `Could not verify the default role for ${source.id}.`);
    }
    targets.push({ subject: user.id, email: user.email, emailVerified: user.emailVerified });
  }
  write({ snapshot, targets });
}

async function main(mode) {
  if (mode === 'export') await withSphere((snapshot) => write(snapshot));
  else if (mode === 'link') await link();
  else if (mode === 'plan' || mode === 'provision') await provision(mode === 'provision');
  else throw new MigrationError('Invalid migration command.');
}

if (process.argv[1] === '--scoretech-migration') main(process.argv[2]).catch((error) => {
  console.error(error instanceof MigrationError ? error.message :
    'Migration failed while reading the input or database. If it was interrupted, correct the problem and rerun before switching sign-in.');
  process.exitCode = 1;
});

module.exports = { plan, providerId, sourceRecord, validateSources };
