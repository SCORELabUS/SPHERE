import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
vi.mock('../../main/config/container', () => ({ default: { resolve: () => ({ findById: async () => ({ ancestors: [] }), resolveOrgRole: async () => null, buildBatchContext: async () => ({ entityPermissions: new Map() }) }) } }));
import Pricing from '../../main/repositories/mongoose/models/PricingMongoose';
import Identity from '../../main/repositories/mongoose/models/PricingIdentityMongoose';
import Collection from '../../main/repositories/mongoose/models/PricingCollectionMongoose';
import PricingRepository from '../../main/repositories/mongoose/PricingRepository';
import PermanentLinkService, { functionalHash } from '../../main/services/PermanentLinkService';
import { up } from '../../main/migrations/mongo/2026092005000-pricing-identities';
import loadRoutes from '../../main/routes/PermanentLinkRoutes';
import express from 'express';
import request from 'supertest';

describe('snapshot fingerprint', () => {
  it('ignores names and mapping order but detects functional changes', () => {
    expect(functionalHash('saasName: A\nversion: 1')).toBe(functionalHash('version: 1\nsaasName: B'));
    expect(functionalHash('version: 1')).not.toBe(functionalHash('version: 2'));
  });
});
const suite = process.env.SPHERE_SYNC_TEST_MONGO === 'true' ? describe : describe.skip;
suite('permanent identities with isolated MongoDB', () => {
  const org = new mongoose.Types.ObjectId();
  const root = '/tmp/sphere-permanent-link-test';
  const service = new PermanentLinkService();
  const repository = new PricingRepository();
  beforeAll(async () => {
    process.env.SERVER_STATICS_FOLDER = root;
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'one.yaml'), 'saasName: Demo\nversion: 1');
    await mongoose.connect('mongodb://127.0.0.1:27981/sphere_permalink_test');
    await Promise.all([Pricing.init(), Identity.init(), Collection.init()]);
  });
  beforeEach(async () => { await Pricing.deleteMany({}); await Identity.deleteMany({}); await Collection.deleteMany({}); });
  afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await fs.rm(root, { recursive: true, force: true }); });
  const data = (version: string, privateVersion = false) => ({ name: 'Demo', slug: 'demo', _organizationId: org,
    version, private: privateVersion, yaml: 'one.yaml', createdAt: new Date(`202${version}-01-01`), currency: 'USD' });
  it('does not allow API keys outside the organization scope to resolve private links', async () => {
    const [version] = await repository.create([data('1', true)]);
    const user = { id: 'admin', role: 'ADMIN', apiKey: { scopes: [] } };
    await expect(service.resolve('pricing', String(version.pricingId), user, 'api-key')).rejects.toThrow('NOT FOUND');
    await expect(service.resolve('pricing', String(version.pricingId), user, 'token')).resolves.toHaveProperty('location');
  });
  it('keeps family links through renames, moves and deleting the first version', async () => {
    const [one] = await repository.create([data('1')]);
    const [two] = await repository.create([data('2')]);
    expect(String(one.pricingId)).toBe(String(two.pricingId));
    const id = String(one.pricingId);
    await repository.update(String(one._id), { name: 'Renamed', slug: 'renamed' });
    await repository.update(String(two._id), { name: 'Renamed', slug: 'renamed' });
    const collection = await Collection.create({ name: 'Collection', slug: 'collection', _organizationId: org });
    await repository.addPricingToCollection('renamed', String(org), String(collection._id));
    expect((await service.resolve('pricing', id)).location).toContain('/renamed?collection=collection');
    collection.name = 'Changed'; collection.slug = 'changed'; await collection.save();
    expect((await service.resolve('pricing', id)).location).toContain('?collection=changed');
    await Pricing.deleteOne({ _id: one._id });
    expect((await service.resolve('pricing', id)).location).toContain('/renamed');
    await Pricing.deleteOne({ _id: two._id });
    await expect(service.resolve('pricing', id)).rejects.toThrow('NOT FOUND');
    const [recreated] = await repository.create([data('1')]);
    expect(String(recreated.pricingId)).not.toBe(id);
  });
  it('keeps separate families separate when a collection move would collide', async () => {
    const collection = await Collection.create({ name: 'Collection', slug: 'collection', _organizationId: org });
    const [root] = await repository.create([data('1')]);
    const [copy] = await repository.create([{ ...data('1'), _collectionId: String(collection._id) }]);
    expect(String(copy.pricingId)).not.toBe(String(root.pricingId));
    await expect(repository.removePricingFromCollection('demo', String(org), String(collection._id))).rejects.toThrow('merge');
    expect((await Pricing.findById(copy._id).lean())?._collectionId).toBe(String(collection._id));
    await repository.destroyBySlugOrganizationAndCollectionId('demo', String(org));
    await expect(service.resolve('pricing', String(root.pricingId))).rejects.toThrow('NOT FOUND');
    await expect(service.resolve('pricing', String(copy.pricingId))).resolves.toHaveProperty('location');
  });
  it('filters private versions before selecting latest and enforces download visibility', async () => {
    const [one] = await repository.create([data('1')]);
    const [two] = await repository.create([data('2', true)]);
    const id = String(one.pricingId);
    const manifest = await service.manifest(id);
    expect(manifest.versions.map(v => v.version)).toEqual(['1']);
    expect(manifest.latestVersionId).toBe(String(one._id));
    await expect(service.download(id, String(two._id))).rejects.toThrow('NOT FOUND');
    await Pricing.updateOne({ _id: one._id }, { $set: { private: true } });
    await expect(service.manifest(id)).rejects.toThrow('NOT FOUND');
    await expect(service.resolve('pricing', id)).rejects.toThrow('NOT FOUND');
  });
  it('supports collection permalinks and denies private collections', async () => {
    const collection = await Collection.create({ name: 'Demo', slug: 'demo', _organizationId: org });
    expect((await service.resolve('collection', String(collection._id))).location).toContain('/demo');
    collection.private = true; await collection.save();
    await expect(service.resolve('collection', String(collection._id))).rejects.toThrow('NOT FOUND');
  });
  it('migrates legacy versions idempotently without merging ambiguous families', async () => {
    await Pricing.collection.insertMany([data('1'), data('2')]);
    await up(mongoose.connection); await up(mongoose.connection);
    expect(await Identity.countDocuments()).toBe(1);
    const rows = await Pricing.find({}).lean(); expect(String(rows[0].pricingId)).toBe(String(rows[1].pricingId));
    await Pricing.collection.insertOne({ ...data('3'), slug: 'other' });
    await expect(up(mongoose.connection)).rejects.toThrow('Ambiguous');
  });
  it('returns 304 only while a pricing remains public', async () => {
    const [one] = await repository.create([data('1')]);
    const app = express(); loadRoutes(app);
    const url = `/api/v1/public/pricings/${one.pricingId}`;
    const response = await request(app).get(url).expect(200);
    await request(app).get(url).set('If-None-Match', response.headers.etag).expect(304);
    await Pricing.updateOne({ _id: one._id }, { $set: { private: true } });
    await request(app).get(url).set('If-None-Match', response.headers.etag).expect(404);
  });
});
