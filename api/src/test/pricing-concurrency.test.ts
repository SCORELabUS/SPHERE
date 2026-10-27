import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { BASE_PATH } from './utils/config/variables';
import testContainer from './utils/config/testContainer';
import { createPricingForOrganization, createValidPricingYaml } from './utils/pricings/pricingTestUtils';
import { createCollectionForOrganization } from './utils/collections/collectionTestUtils';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import PricingIdentityMongoose from '../main/repositories/mongoose/models/PricingIdentityMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import { createMembership } from './utils/organizations';
import { createEntityPermission } from './utils/permissions/permissionTestUtils';

dotenv.config();

/** The tag this API gives a pricing: strong, naming its id and revision (not Express's weak body hash). */
const PRICING_ETAG = /^"[0-9a-f]{24}\.\d+"$/;

/**
 * Optimistic concurrency for pricing edits: reads of a pricing carry an ETag,
 * and every write that changes an existing pricing accepts If-Match. A stale
 * tag gets 412 and changes nothing; no If-Match keeps the old behaviour.
 */
describe('Pricing ETag and If-Match', () => {
  let app: TestApp;
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');
  const collectionIdsToDelete: Set<string> = testContainer.resolve('collectionIdsToDelete');
  const membershipsToDelete: Set<string> = testContainer.resolve('membershipsToDelete');
  const permissionsToDelete = new Set<string>();

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    delete process.env.PRICING_REQUIRE_IF_MATCH;
    for (const username of usersToDelete) await deleteTestUser(username);
    usersToDelete.clear();
    for (const pricingId of pricingsToDelete) await PricingMongoose.deleteOne({ _id: pricingId });
    pricingsToDelete.clear();
    for (const filePath of generatedFilesToDelete) await fs.rm(filePath, { force: true });
    generatedFilesToDelete.clear();
    for (const collectionId of collectionIdsToDelete) await PricingCollectionMongoose.deleteOne({ _id: collectionId });
    collectionIdsToDelete.clear();
    for (const membershipId of membershipsToDelete) await OrganizationMembershipMongoose.deleteOne({ _id: membershipId });
    membershipsToDelete.clear();
    for (const permissionId of permissionsToDelete) await EntityPermissionMongoose.deleteOne({ _id: permissionId });
    permissionsToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  /** An organization owned by a new user, with one public pricing of one version. */
  async function ownedPricing() {
    const { user: owner, organizationId } = await createAndLoginUser('USER');
    const created = await createPricingForOrganization({ organizationId, isPrivate: false });
    return {
      token: owner.token,
      organizationId,
      slug: created.response.body.slug as string,
      name: created.serviceName,
      version: created.version,
      pricingUrl: `${BASE_PATH}/pricings/${organizationId}/${created.response.body.slug}`,
    };
  }

  async function currentEtag(pricingUrl: string, token: string) {
    const response = await request(app).get(pricingUrl).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.etag).toMatch(PRICING_ETAG);
    return response.headers.etag as string;
  }

  async function storedVersions(organizationId: string, slug: string) {
    return PricingMongoose.find({ _organizationId: organizationId, slug }).lean();
  }

  async function addVersion(
    target: { token: string; organizationId: string; slug: string; name: string },
    ifMatch?: string,
    isPrivate = false
  ) {
    const fixture = await createValidPricingYaml(target.name);
    const call = request(app)
      .post(`${BASE_PATH}/pricings/${target.organizationId}/${target.slug}/${fixture.version}`)
      .set('Authorization', `Bearer ${target.token}`);
    if (ifMatch !== undefined) call.set('If-Match', ifMatch);
    const response = await call.field('private', String(isPrivate)).attach('yaml', fixture.filePath);
    if (response.status === 200) {
      pricingsToDelete.add(response.body.id);
      if (typeof response.body.yaml === 'string') {
        const relativePath = response.body.yaml.replace(/^https?:\/\/[^/]+\//, '');
        generatedFilesToDelete.add(path.resolve(process.cwd(), 'public', relativePath));
      }
    }
    return { response, version: fixture.version };
  }

  /** A user of the organization as plain MEMBER, with these permissions on the pricing (none if omitted). */
  async function memberOf(
    target: { organizationId: string; slug: string },
    permissions?: { GET: boolean; PUT: boolean; DELETE: boolean; CREATE: boolean }
  ) {
    const { user } = await createAndLoginUser('USER');
    await createMembership(user.id, target.organizationId, 'MEMBER');
    if (permissions) {
      const permission = await createEntityPermission(user.id, target.organizationId, 'pricing', target.slug, permissions);
      permissionsToDelete.add(String(permission._id ?? permission.id));
    }
    return user.token;
  }

  /** The pricing's tag as the database has it, as a caller could guess it from the (public) pricing id. */
  async function storedTag(organizationId: string, slug: string) {
    const identity: any = await PricingIdentityMongoose.findOne({ _organizationId: organizationId, slug, deleted: false }).lean();
    return `"${identity._id}.${identity.revision ?? 0}"`;
  }

  /** A pricing with a public and a private version. */
  async function pricingWithPrivateVersion() {
    const target = await ownedPricing();
    const hidden = await addVersion(target, undefined, true);
    expect(hidden.response.status).toBe(200);
    return { ...target, privateVersion: hidden.version };
  }

  /** The headers a response carries, without the ones that change with the clock or the connection. */
  function stableHeaders(response: { headers: Record<string, string> }) {
    const { date, connection, 'keep-alive': keepAlive, ...rest } = response.headers;
    void date;
    void connection;
    void keepAlive;
    return rest;
  }

  describe('Who gets the ETag', () => {
    it('Gives no revision ETag to callers who may not read the private versions, and gives it to those who may.', async () => {
      const target = await pricingWithPrivateVersion();
      const { user: outsider } = await createAndLoginUser('USER');
      const plainMember = await memberOf(target);
      const reader = await memberOf(target, { GET: true, PUT: false, DELETE: false, CREATE: false });

      for (const token of [undefined, outsider.token, plainMember]) {
        const call = request(app).get(target.pricingUrl);
        if (token) call.set('Authorization', `Bearer ${token}`);
        const response = await call;
        expect(response.status).toBe(200);
        expect(response.body.versions).toHaveLength(1);
        expect(response.headers.etag ?? '').not.toMatch(PRICING_ETAG);
      }

      const owners = await currentEtag(target.pricingUrl, target.token);
      expect(await currentEtag(target.pricingUrl, reader)).toBe(owners);
    });

    it('Does not let those callers notice a change to a private version through any header.', async () => {
      const target = await pricingWithPrivateVersion();
      const plainMember = await memberOf(target);
      const look = async () => ({
        anonymous: await request(app).get(target.pricingUrl),
        member: await request(app).get(target.pricingUrl).set('Authorization', `Bearer ${plainMember}`),
      });

      const before = await look();
      const ownersBefore = await currentEtag(target.pricingUrl, target.token);

      // Changes only to private versions: one is added, another one deleted.
      expect((await addVersion(target, undefined, true)).response.status).toBe(200);
      const deleted = await request(app)
        .delete(`${target.pricingUrl}/${target.privateVersion}`)
        .set('Authorization', `Bearer ${target.token}`);
      expect(deleted.status).toBe(200);

      const after = await look();
      expect(await currentEtag(target.pricingUrl, target.token)).not.toBe(ownersBefore);
      for (const who of ['anonymous', 'member'] as const) {
        expect(after[who].status).toBe(200);
        expect(stableHeaders(after[who])).toEqual(stableHeaders(before[who]));
        expect(after[who].body).toEqual(before[who].body);
      }
    });

    it('Gives a writer who may not read the private versions no ETag, and no If-Match of theirs matches.', async () => {
      const target = await pricingWithPrivateVersion();
      const editor = await memberOf(target, { GET: false, PUT: true, DELETE: false, CREATE: false });

      const read = await request(app).get(target.pricingUrl).set('Authorization', `Bearer ${editor}`);
      expect(read.headers.etag ?? '').not.toMatch(PRICING_ETAG);

      const written = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${editor}`)
        .send({ url: 'https://example.com/editor' });
      expect(written.status).toBe(200);
      expect(written.headers.etag ?? '').not.toMatch(PRICING_ETAG);

      // Even the right tag, guessed from the public pricing id, tells them nothing.
      const probe = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${editor}`)
        .set('If-Match', await storedTag(target.organizationId, target.slug))
        .send({ url: 'https://example.com/probe' });
      expect(probe.status).toBe(412);
      expect(probe.headers.etag ?? '').not.toMatch(PRICING_ETAG);
      const versions = await storedVersions(target.organizationId, target.slug);
      expect(versions.every(version => version.url === 'https://example.com/editor')).toBe(true);

      const anyVersion = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${editor}`)
        .set('If-Match', '*')
        .send({ url: 'https://example.com/star' });
      expect(anyVersion.status).toBe(200);
    });
  });

  describe('GET /api/v1/pricings/:organizationId/:pricingSlug', () => {
    it('Returns a strong ETag naming the pricing and its revision, and is not cached.', async () => {
      const target = await ownedPricing();

      const response = await request(app)
        .get(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`);

      expect(response.status).toBe(200);
      expect(response.headers.etag).toMatch(PRICING_ETAG);
      expect(response.headers.etag).toContain(response.body.pricingId);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('Gives no revision ETag to anonymous readers, even of a pricing whose versions are all public.', async () => {
      const target = await ownedPricing();

      const anonymous = await request(app).get(target.pricingUrl);

      expect(anonymous.status).toBe(200);
      expect(anonymous.body.versions).toHaveLength(1);
      expect(anonymous.headers.etag ?? '').not.toMatch(PRICING_ETAG);
      expect(await currentEtag(target.pricingUrl, target.token)).toMatch(PRICING_ETAG);
    });
  });

  describe('PUT /api/v1/pricings/:organizationId/:pricingSlug', () => {
    it('Returns 200 and a new ETag, the one a later read returns, when If-Match is current.', async () => {
      const target = await ownedPricing();
      const etag = await currentEtag(target.pricingUrl, target.token);

      const response = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', etag)
        .send({ private: true });

      expect(response.status).toBe(200);
      expect(response.headers.etag).toMatch(PRICING_ETAG);
      expect(response.headers.etag).not.toBe(etag);
      expect(await currentEtag(target.pricingUrl, target.token)).toBe(response.headers.etag);
      const versions = await storedVersions(target.organizationId, target.slug);
      expect(versions.every(version => version.private === true)).toBe(true);
    });

    it('Returns 412 with the current ETag and changes nothing when If-Match is stale.', async () => {
      const target = await ownedPricing();
      const stale = await currentEtag(target.pricingUrl, target.token);

      // Someone else (here without If-Match, as an integration would) changes it first.
      const other = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .send({ private: true });
      expect(other.status).toBe(200);
      const current = await currentEtag(target.pricingUrl, target.token);
      expect(current).not.toBe(stale);

      const response = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', stale)
        .send({ private: false, name: `renamed_${Date.now()}` });

      expect(response.status).toBe(412);
      expect(response.body.error).toMatch(/precondition failed/i);
      expect(response.headers.etag).toBe(current);
      const versions = await storedVersions(target.organizationId, target.slug);
      expect(versions).toHaveLength(1);
      expect(versions[0].private).toBe(true);
      expect(versions[0].name).toBe(target.name);
      expect(await currentEtag(target.pricingUrl, target.token)).toBe(current);
    });

    it('Lets exactly one of two concurrent writes with the same ETag win.', async () => {
      const target = await ownedPricing();
      const etag = await currentEtag(target.pricingUrl, target.token);

      const [first, second] = await Promise.all(
        [true, false].map(isPrivate =>
          request(app)
            .put(target.pricingUrl)
            .set('Authorization', `Bearer ${target.token}`)
            .set('If-Match', etag)
            .send({ private: isPrivate, url: `https://example.com/${isPrivate}` })
        )
      );

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 412]);
      const winner = first.status === 200 ? true : false;
      const versions = await storedVersions(target.organizationId, target.slug);
      expect(versions[0].private).toBe(winner);
      expect(versions[0].url).toBe(`https://example.com/${winner}`);
    });

    it('Keeps working without If-Match, and still moves the ETag on.', async () => {
      const target = await ownedPricing();
      const before = await currentEtag(target.pricingUrl, target.token);

      const response = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .send({ private: true });

      expect(response.status).toBe(200);
      expect(response.body.versions[0].private).toBe(true);
      expect(response.headers.etag).toMatch(PRICING_ETAG);
      expect(response.headers.etag).not.toBe(before);
    });

    it('Accepts If-Match: * and a tag weakened by a proxy, and refuses a malformed one with 412.', async () => {
      const target = await ownedPricing();

      const star = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', '*')
        .send({ private: true });
      expect(star.status).toBe(200);

      const weakened = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', `W/${star.headers.etag}`)
        .send({ private: false });
      expect(weakened.status).toBe(200);

      const malformed = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', 'not-a-tag')
        .send({ private: true });
      expect(malformed.status).toBe(412);
      const versions = await storedVersions(target.organizationId, target.slug);
      expect(versions[0].private).toBe(false);
    });

    it('Matches any of several listed tags.', async () => {
      const target = await ownedPricing();
      const etag = await currentEtag(target.pricingUrl, target.token);

      const response = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', `"000000000000000000000000.1", ${etag}`)
        .send({ private: true });

      expect(response.status).toBe(200);
    });

    it('Still answers 403 before 412 to a caller without permission.', async () => {
      const target = await ownedPricing();
      const { user: stranger } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${stranger.token}`)
        .set('If-Match', '"000000000000000000000000.1"')
        .send({ private: true });

      expect(response.status).toBe(403);
    });

    it('Answers 428 to a write without If-Match only when PRICING_REQUIRE_IF_MATCH is on.', async () => {
      const target = await ownedPricing();
      process.env.PRICING_REQUIRE_IF_MATCH = 'true';

      const missing = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .send({ private: true });
      expect(missing.status).toBe(428);
      expect(missing.body.error).toMatch(/precondition required/i);
      expect((await storedVersions(target.organizationId, target.slug))[0].private).toBe(false);

      const etag = await currentEtag(target.pricingUrl, target.token);
      const present = await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', etag)
        .send({ private: true });
      expect(present.status).toBe(200);
    });
  });

  describe('PUT /api/v1/pricings/:organizationId/:pricingSlug/:pricingVersion', () => {
    it('Changes one version with a current If-Match and returns the new ETag.', async () => {
      const target = await ownedPricing();
      const etag = await currentEtag(target.pricingUrl, target.token);

      const response = await request(app)
        .put(`${target.pricingUrl}/${target.version}`)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', etag)
        .send({ private: true });

      expect(response.status).toBe(200);
      expect(response.headers.etag).not.toBe(etag);
      expect(await currentEtag(target.pricingUrl, target.token)).toBe(response.headers.etag);
    });

    it('Returns 412 and leaves the version as it was when If-Match is stale.', async () => {
      const target = await ownedPricing();
      const stale = await currentEtag(target.pricingUrl, target.token);
      await request(app)
        .put(`${target.pricingUrl}/${target.version}`)
        .set('Authorization', `Bearer ${target.token}`)
        .send({ private: true });

      const response = await request(app)
        .put(`${target.pricingUrl}/${target.version}`)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', stale)
        .send({ private: false });

      expect(response.status).toBe(412);
      expect(response.headers.etag).toBe(await currentEtag(target.pricingUrl, target.token));
      expect((await storedVersions(target.organizationId, target.slug))[0].private).toBe(true);
    });

    it('Lets exactly one of two concurrent version changes with the same ETag win.', async () => {
      const target = await ownedPricing();
      const second = await addVersion(target);
      expect(second.response.status).toBe(200);
      const etag = await currentEtag(target.pricingUrl, target.token);

      const responses = await Promise.all(
        [target.version, second.version].map(version =>
          request(app)
            .put(`${target.pricingUrl}/${version}`)
            .set('Authorization', `Bearer ${target.token}`)
            .set('If-Match', etag)
            .send({ private: true })
        )
      );

      expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
      const versions = await storedVersions(target.organizationId, target.slug);
      expect(versions.filter(version => version.private)).toHaveLength(1);
    });
  });

  describe('DELETE /api/v1/pricings/:organizationId/:pricingSlug/:pricingVersion', () => {
    it('Returns 412 and keeps the version when If-Match is stale, and deletes it when current.', async () => {
      const target = await ownedPricing();
      const second = await addVersion(target);
      expect(second.response.status).toBe(200);
      const stale = await currentEtag(target.pricingUrl, target.token);
      await request(app)
        .put(`${target.pricingUrl}/${target.version}`)
        .set('Authorization', `Bearer ${target.token}`)
        .send({ private: true });

      const refused = await request(app)
        .delete(`${target.pricingUrl}/${second.version}`)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', stale);
      expect(refused.status).toBe(412);
      expect(await storedVersions(target.organizationId, target.slug)).toHaveLength(2);

      const current = await currentEtag(target.pricingUrl, target.token);
      const deleted = await request(app)
        .delete(`${target.pricingUrl}/${second.version}`)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', current);
      expect(deleted.status).toBe(200);
      expect(deleted.headers.etag).not.toBe(current);
      expect(await currentEtag(target.pricingUrl, target.token)).toBe(deleted.headers.etag);
      expect(await storedVersions(target.organizationId, target.slug)).toHaveLength(1);
    });
  });

  describe('DELETE /api/v1/pricings/:organizationId/:pricingSlug', () => {
    it('Returns 412 and keeps the pricing when a version was added after the read.', async () => {
      const target = await ownedPricing();
      const stale = await currentEtag(target.pricingUrl, target.token);
      const added = await addVersion(target);
      expect(added.response.status).toBe(200);

      const refused = await request(app)
        .delete(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', stale);
      expect(refused.status).toBe(412);
      expect(await storedVersions(target.organizationId, target.slug)).toHaveLength(2);

      const deleted = await request(app)
        .delete(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .set('If-Match', await currentEtag(target.pricingUrl, target.token));
      expect(deleted.status).toBe(200);
      expect(await storedVersions(target.organizationId, target.slug)).toHaveLength(0);
    });
  });

  describe('POST /api/v1/pricings/:organizationId/:pricingSlug/:pricingVersion', () => {
    it('Adds the version with a current If-Match and returns the new ETag.', async () => {
      const target = await ownedPricing();
      const etag = await currentEtag(target.pricingUrl, target.token);

      const { response } = await addVersion(target, etag);

      expect(response.status).toBe(200);
      expect(response.headers.etag).not.toBe(etag);
      expect(await currentEtag(target.pricingUrl, target.token)).toBe(response.headers.etag);
    });

    it('Returns 412 and adds nothing when If-Match is stale.', async () => {
      const target = await ownedPricing();
      const stale = await currentEtag(target.pricingUrl, target.token);
      await request(app)
        .put(target.pricingUrl)
        .set('Authorization', `Bearer ${target.token}`)
        .send({ private: true });

      const { response } = await addVersion(target, stale);

      expect(response.status).toBe(412);
      expect(await storedVersions(target.organizationId, target.slug)).toHaveLength(1);
    });

    it('Is not refused without If-Match even when PRICING_REQUIRE_IF_MATCH is on: adding overwrites nothing.', async () => {
      const target = await ownedPricing();
      process.env.PRICING_REQUIRE_IF_MATCH = 'true';

      const { response } = await addVersion(target);

      expect(response.status).toBe(200);
    });
  });

  describe('Changes made elsewhere', () => {
    it('Moving the pricing into a collection changes its ETag.', async () => {
      const target = await ownedPricing();
      const collection = await createCollectionForOrganization(target.organizationId);
      const before = await currentEtag(target.pricingUrl, target.token);

      const moved = await request(app)
        .post(`${BASE_PATH}/collections/${target.organizationId}/${collection.slug}`)
        .set('Authorization', `Bearer ${target.token}`)
        .send({ pricingSlug: target.slug });
      expect(moved.status).toBe(200);

      expect(await currentEtag(target.pricingUrl, target.token)).not.toBe(before);
    });
  });
});
