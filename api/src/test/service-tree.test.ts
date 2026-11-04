import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { BASE_PATH } from './utils/config/variables';
import testContainer from './utils/config/testContainer';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { createMembership } from './utils/organizations';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import ServiceTreeMongoose from '../main/repositories/mongoose/models/ServiceTreeMongoose';

dotenv.config();

describe('Service tree (beta) API integration', () => {
  let app: TestApp;
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');
  const membershipsToDelete: Set<string> = testContainer.resolve('membershipsToDelete');
  const treesToDelete = new Set<string>();

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    for (const username of usersToDelete) await deleteTestUser(username);
    usersToDelete.clear();
    for (const pricingId of pricingsToDelete) await PricingMongoose.deleteOne({ _id: pricingId });
    pricingsToDelete.clear();
    for (const filePath of generatedFilesToDelete) await fs.rm(filePath, { force: true });
    generatedFilesToDelete.clear();
    for (const membershipId of membershipsToDelete) await OrganizationMembershipMongoose.deleteOne({ _id: membershipId });
    membershipsToDelete.clear();
    for (const organizationId of treesToDelete) await ServiceTreeMongoose.deleteOne({ _organizationId: organizationId });
    treesToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  const servicesPath = (organizationId: string) => `${BASE_PATH}/orgs/${organizationId}/services`;

  const enableBeta = (token: string) =>
    request(app).put(`${BASE_PATH}/users/me/settings/beta-features`).set('Authorization', `Bearer ${token}`).send({ enabled: true });

  /** An organization whose owner turned beta features on. */
  async function betaOwner() {
    const { user, organizationId } = await createAndLoginUser('USER');
    await enableBeta(user.token);
    treesToDelete.add(organizationId);
    return { token: user.token, organizationId };
  }

  /** The pricing identity (pricingId) of a new pricing of the organization. */
  async function pricingOf(organizationId: string, isPrivate = false) {
    const created = await createPricingForOrganization({ organizationId, isPrivate });
    const version: any = await PricingMongoose.findById(created.id).lean();
    return { pricingId: String(version.pricingId), name: created.serviceName };
  }

  const save = (token: string, organizationId: string, body: object) =>
    request(app).put(servicesPath(organizationId)).set('Authorization', `Bearer ${token}`).send(body);

  const node = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    parentId: null,
    name: `Service ${id}`,
    kind: 'AUTONOMOUS',
    pricingIds: [],
    ...overrides,
  });

  it('Answers 403 to a member who has not turned beta features on.', async () => {
    const { user, organizationId } = await createAndLoginUser('USER');

    const response = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${user.token}`);

    expect(response.status).toBe(403);
  });

  it('Returns an empty tree that the owner can edit before anything was saved.', async () => {
    const { token, organizationId } = await betaOwner();

    const response = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ nodes: [], revision: 0, pricings: {}, canEdit: true });
  });

  it('Saves a tree with linked pricings and returns them with their names.', async () => {
    const { token, organizationId } = await betaOwner();
    const pricing = await pricingOf(organizationId);

    const saved = await save(token, organizationId, {
      revision: 0,
      nodes: [
        node('github', { pricingIds: [pricing.pricingId], description: 'Code hosting' }),
        node('actions', { parentId: 'github', kind: 'DEPENDENT', dependency: 'FUNCTIONAL' }),
      ],
    });

    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(1);
    expect(saved.body.nodes).toHaveLength(2);
    expect(saved.body.nodes[1]).toMatchObject({ id: 'actions', parentId: 'github', kind: 'DEPENDENT', dependency: 'FUNCTIONAL' });
    expect(saved.body.pricings[pricing.pricingId]).toMatchObject({ pricingId: pricing.pricingId, name: pricing.name });

    const read = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${token}`);
    expect(read.body.nodes.map((n: any) => n.id)).toEqual(['github', 'actions']);
    expect(read.body.nodes[0].description).toBe('Code hosting');
  });

  it('Refuses with 409 a save based on an old revision.', async () => {
    const { token, organizationId } = await betaOwner();
    await save(token, organizationId, { revision: 0, nodes: [node('a')] });

    const stale = await save(token, organizationId, { revision: 0, nodes: [node('b')] });

    expect(stale.status).toBe(409);
    const read = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${token}`);
    expect(read.body.nodes.map((n: any) => n.id)).toEqual(['a']);
  });

  it('Refuses invalid trees with 422.', async () => {
    const { token, organizationId } = await betaOwner();
    const { organizationId: otherOrganizationId } = await createAndLoginUser('USER');
    const foreign = await pricingOf(otherOrganizationId);

    const invalidTrees = [
      [node('a', { parentId: 'b' }), node('b', { parentId: 'a' })],
      [node('a', { parentId: 'missing' })],
      [node('a'), node('a')],
      [node('a', { name: '   ' })],
      [node('a', { kind: 42 })],
      [node('a', { kind: 'x'.repeat(41) })],
      [node('a', { dependency: ['FUNCTIONAL'] })],
      [node('a', { pricingIds: [foreign.pricingId] })],
      [node('bad id!')],
    ];
    for (const nodes of invalidTrees) {
      const response = await save(token, organizationId, { revision: 0, nodes });
      expect(response.status, JSON.stringify(nodes)).toBe(422);
    }
  });

  it('Keeps kinds and dependencies the organization makes up, and writes the known ones the same way.', async () => {
    const { token, organizationId } = await betaOwner();

    const saved = await save(token, organizationId, {
      revision: 0,
      nodes: [
        node('core', { kind: 'autonomous' }),
        node('addon', { parentId: 'core', kind: 'Add-on', dependency: 'functional' }),
        node('bundle', { kind: 'Bundle', dependency: 'Needs a contract' }),
        node('draft', { kind: null }),
        node('blank', { kind: '  ' }),
      ],
    });

    expect(saved.status).toBe(200);
    expect(saved.body.nodes.map((n: any) => [n.kind, n.dependency])).toEqual([
      ['AUTONOMOUS', null],
      ['Add-on', 'FUNCTIONAL'],
      ['Bundle', 'Needs a contract'],
      [null, null],
      [null, null],
    ]);
  });

  it('Keeps the free attributes of a service as they were given.', async () => {
    const { token, organizationId } = await betaOwner();
    const attributes = { customers: ['Acme', 'Globex'], tier: 'enterprise', limits: { seats: 50, sso: true } };

    const saved = await save(token, organizationId, { revision: 0, nodes: [node('a', { attributes }), node('b')] });

    expect(saved.status).toBe(200);
    expect(saved.body.nodes[0].attributes).toEqual(attributes);
    expect(saved.body.nodes[1].attributes).toEqual({});
    const read = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${token}`);
    expect(read.body.nodes[0].attributes).toEqual(attributes);
  });

  it('Refuses attributes that are not an object, use a reserved or invalid name, or are too large.', async () => {
    const { token, organizationId } = await betaOwner();

    const invalid = [
      ['Acme'],
      { name: 'clash' },
      { pricings: [] },
      { '1st': true },
      { nested: { $where: 'x' } },
      { nested: { 'a.b': 1 } },
      { big: 'x'.repeat(5000) },
      { deep: { a: { b: { c: { d: { e: 1 } } } } } },
    ];
    for (const attributes of invalid) {
      const response = await save(token, organizationId, { revision: 0, nodes: [node('a', { attributes })] });
      expect(response.status, JSON.stringify(attributes)).toBe(422);
    }
  });

  it('Lets members read the tree but not change it.', async () => {
    const { token, organizationId } = await betaOwner();
    await save(token, organizationId, { revision: 0, nodes: [node('a')] });
    const { user: member } = await createAndLoginUser('USER');
    await createMembership(member.id, organizationId, 'MEMBER');
    await enableBeta(member.token);

    const read = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${member.token}`);
    const write = await save(member.token, organizationId, { revision: 1, nodes: [] });

    expect(read.status).toBe(200);
    expect(read.body.canEdit).toBe(false);
    expect(read.body.nodes).toHaveLength(1);
    expect(write.status).toBe(403);
  });

  it('Leaves out of the response the linked pricings a member may not see.', async () => {
    const { token, organizationId } = await betaOwner();
    const hidden = await pricingOf(organizationId, true);
    const visible = await pricingOf(organizationId, false);
    await save(token, organizationId, {
      revision: 0,
      nodes: [node('a', { pricingIds: [hidden.pricingId, visible.pricingId] })],
    });
    const { user: member } = await createAndLoginUser('USER');
    await createMembership(member.id, organizationId, 'MEMBER');
    await enableBeta(member.token);

    const asMember = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${member.token}`);
    const asOwner = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${token}`);

    expect(Object.keys(asMember.body.pricings)).toEqual([visible.pricingId]);
    expect(JSON.stringify(asMember.body)).not.toContain(hidden.name);
    expect(Object.keys(asOwner.body.pricings).sort()).toEqual([hidden.pricingId, visible.pricingId].sort());
  });

  it('Answers 403 to a user outside the organization.', async () => {
    const { organizationId } = await betaOwner();
    const { user: outsider } = await createAndLoginUser('USER');
    await enableBeta(outsider.token);

    const response = await request(app).get(servicesPath(organizationId)).set('Authorization', `Bearer ${outsider.token}`);

    expect(response.status).toBe(403);
  });
});
