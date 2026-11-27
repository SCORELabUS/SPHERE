import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The parts of anonymous links that need no database: credentials dropped on
 * the public routes only, the bounded file read, the token, and the service
 * answering a malformed token without a single query.
 */
const repository = {
  findByToken: vi.fn(),
  findShareableVersion: vi.fn(),
  isStillShareable: vi.fn(),
  visibleVersions: vi.fn(),
};
vi.mock('../../main/config/container', () => ({
  default: { resolve: (name: string) => (name === 'pricingAnonymousLinkRepository' ? repository : {}) },
}));

const { anonymousAccess } = await import('../../main/middlewares/AnonymousAccessMiddleware');
const { readPricingFile } = await import('../../main/utils/pricing-files');
const { default: PricingAnonymousLinkService } = await import('../../main/services/PricingAnonymousLinkService');
const { ANONYMOUS_TOKEN_PATTERN, MAX_ANONYMOUS_YAML_BYTES } = await import('../../main/types/models/PricingAnonymousLink');

const credentials = () => ({ authorization: 'Bearer token', 'x-api-key': 'sk-key', cookie: 'a=b', accept: 'application/json' });

describe('anonymousAccess', () => {
  it('drops authorization, x-api-key and cookie under /anonymous-pricings/ only, whatever the case', () => {
    for (const url of ['/api/v1/anonymous-pricings/abc', '/api/v1/anonymous-pricings/abc/yaml', '/api/v1/anonymous-pricings/abc/configuration-space', '/API/V1/Anonymous-Pricings/abc']) {
      const req: any = { path: url, headers: credentials() };
      const next = vi.fn();
      anonymousAccess(req, {} as any, next);
      expect(req.headers, url).toEqual({ accept: 'application/json' });
      expect(next).toHaveBeenCalledOnce();
    }
    for (const url of ['/api/v1/pricing-anonymous-links', '/api/v1/pricings/org/slug', '/api/v1/anonymous-pricingsx/abc', '/anonymous-pricings/abc']) {
      const req: any = { path: url, headers: credentials() };
      anonymousAccess(req, {} as any, vi.fn());
      expect(req.headers, url).toEqual(credentials());
    }
  });
});

describe('readPricingFile', () => {
  let statics: string;
  const previous = process.env.SERVER_STATICS_FOLDER;

  beforeEach(() => {
    statics = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-statics-'));
    fs.mkdirSync(path.join(statics, 'static', 'pricings', 'uploaded'), { recursive: true });
    process.env.SERVER_STATICS_FOLDER = statics;
  });
  afterEach(() => {
    process.env.SERVER_STATICS_FOLDER = previous;
    fs.rmSync(statics, { recursive: true, force: true });
  });

  it('reads a file inside the pricing folders and refuses one outside, a missing one and one over the limit', async () => {
    fs.writeFileSync(path.join(statics, 'static', 'pricings', 'uploaded', 'ok.yml'), 'saasName: ok\n');
    fs.writeFileSync(path.join(statics, 'static', 'pricings', 'uploaded', 'big.yml'), 'x'.repeat(2048));
    fs.writeFileSync(path.join(statics, 'secret.yml'), 'secret');

    expect((await readPricingFile('static/pricings/uploaded/ok.yml', 1024)).toString()).toBe('saasName: ok\n');
    await expect(readPricingFile('static/pricings/uploaded/big.yml', 1024)).rejects.toThrow('NOT FOUND');
    await expect(readPricingFile('static/pricings/uploaded/missing.yml', 1024)).rejects.toThrow('NOT FOUND');
    await expect(readPricingFile('secret.yml', 1024)).rejects.toThrow('NOT FOUND');
    await expect(readPricingFile('static/pricings/../../secret.yml', 1024)).rejects.toThrow('NOT FOUND');
    await expect(readPricingFile('static/pricings/uploaded', 1024)).rejects.toThrow('NOT FOUND');
  });
});

describe('PricingAnonymousLinkService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes tokens of 32 base64url characters from 24 random bytes, never twice the same', () => {
    const service = new PricingAnonymousLinkService();
    const tokens = new Set(Array.from({ length: 200 }, () => service.generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(ANONYMOUS_TOKEN_PATTERN);
    expect(Buffer.from([...tokens][0], 'base64url')).toHaveLength(24);
  });

  it('answers a malformed token without asking the repository anything', async () => {
    const service = new PricingAnonymousLinkService();
    for (const token of ['', 'a'.repeat(31), 'a'.repeat(33), 'a'.repeat(1000), `${'a'.repeat(31)}.`, `${'a'.repeat(30)}/x`, `${'a'.repeat(31)}é`, 123, null, undefined, ['a'.repeat(32)]]) {
      expect(await service.resolve(token as any)).toBeNull();
    }
    expect(repository.findByToken).not.toHaveBeenCalled();
  });

  it('answers null when the file cannot be read or changed while it was read', async () => {
    const service = new PricingAnonymousLinkService();
    const link = { _id: 'l', pricingId: 'p', versionId: 'v' };
    const version = { _id: 'v', version: '1.0', createdAt: new Date(), yaml: 'static/pricings/uploaded/x.yml', analytics: {} };
    repository.findByToken.mockResolvedValue(link);
    repository.findShareableVersion.mockResolvedValue(version);
    service.readFile = vi.fn().mockRejectedValue(new Error('NOT FOUND'));
    expect(await service.resolve('a'.repeat(32))).toBeNull();

    service.readFile = vi.fn().mockResolvedValue(Buffer.from('saasName: x\n'));
    repository.isStillShareable.mockResolvedValue(false);
    expect(await service.resolve('a'.repeat(32))).toBeNull();
  });

  it('lists only versions still shareable on an all-versions link, without ids', async () => {
    const service = new PricingAnonymousLinkService();
    const version = { _id: 'v', version: '2024', createdAt: new Date(), yaml: 'one', analytics: { numberOfPlans: 2 } };
    const hidden = { ...version, _id: 'hidden', version: '2023' };
    repository.findByToken.mockResolvedValue({ _id: 'l', pricingId: 'p', versionId: 'v', allVersions: true });
    repository.findShareableVersion.mockResolvedValue(version);
    repository.visibleVersions.mockResolvedValue([version, hidden]);
    repository.isStillShareable.mockImplementation(async (_link, candidate) => candidate._id !== 'hidden');
    service.readFile = vi.fn().mockResolvedValue(Buffer.from('yaml'));
    const resolved = await service.resolve('a'.repeat(32), '2024');
    expect(repository.findShareableVersion).toHaveBeenCalledWith(expect.anything(), '2024');
    expect(resolved?.pricing.versions).toEqual([{ version: '2024', createdAt: version.createdAt, analytics: { numberOfPlans: 2 } }]);
  });

  it('keeps to the closed list of keys and analytics, and resolves a 5 MiB file in under a second', async () => {
    const service = new PricingAnonymousLinkService();
    const version = {
      _id: 'v', version: '2024', createdAt: new Date('2024-01-01'), yaml: 'static/pricings/uploaded/x.yml',
      analytics: { numberOfPlans: 3, minSubscriptionPrice: 0, maxSubscriptionPrice: Number.NaN, organizationName: 'Acme', forkedFrom: 'x' },
      organization: { name: 'Acme' },
    };
    repository.findByToken.mockResolvedValue({ _id: 'l', pricingId: 'p', versionId: 'v' });
    repository.findShareableVersion.mockResolvedValue(version);
    repository.isStillShareable.mockResolvedValue(true);
    const big = Buffer.alloc(MAX_ANONYMOUS_YAML_BYTES, 'a');
    service.readFile = vi.fn().mockResolvedValue(big);

    const started = performance.now();
    const resolved = await service.resolve('a'.repeat(32));
    JSON.stringify(resolved!.pricing);
    expect(performance.now() - started).toBeLessThan(1000);

    expect(Object.keys(resolved!.pricing).sort()).toEqual(['analytics', 'createdAt', 'version', 'yaml']);
    expect(resolved!.pricing.analytics).toEqual({ numberOfPlans: 3, minSubscriptionPrice: 0 });
    expect(resolved!.file).toBe(big);
  });
});
