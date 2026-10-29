import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import PricingService from '../../main/services/PricingService';
import { parseIfMatch } from '../../main/utils/pricing-etag';

vi.mock('../../main/config/container', () => ({ default: { resolve: vi.fn() } }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Real service methods, with storage paused precisely between revision claim and content write. */
function fixture() {
  const pricingId = '0123456789abcdef01234567';
  let revision = 0;
  let url = 'original';
  const started = deferred();
  const resume = deferred();
  const pricing = () => ({ pricingId, slug: 'sample', private: false, url,
    versions: [{ id: 'version', version: '1.0.0', yaml: '' }] });
  const repository = {
    findOne: async () => pricing(),
    findRevisionsBySlug: vi.fn(async () => new Map([[pricingId, revision]])),
    findRevision: async () => revision,
    claimRevision: async (_id: string, precondition: ReturnType<typeof parseIfMatch>) => {
      if (precondition?.kind !== 'tags' || !precondition.tags.some(tag => tag.pricingId === pricingId && tag.revision === revision)) return false;
      revision++;
      return true;
    },
    update: vi.fn(async (_id: string, data: { url: string }) => {
      if (data.url === 'first writer') {
        started.resolve();
        await resume.promise;
      }
      url = data.url;
      revision++;
    }),
  };
  const service = Object.assign(Object.create(PricingService.prototype) as PricingService, {
    pricingRepository: repository,
    permissionService: { checkPricingPut: async () => ({ allowed: true }), resolveOrgRole: async () => 'OWNER', buildBatchContext: async () => ({ entityPermissions: new Map() }) },
    permissionEngine: { evaluate: () => ({ allowed: true }) },
    _canSeePrivateVersions: async () => true,
    show: async () => pricing(),
  }) as unknown as PricingService;
  // Another service instance in the same API process must observe the same guard.
  const reader = Object.assign(Object.create(PricingService.prototype) as PricingService, service);
  const user = { id: 'owner', role: 'USER' } as Parameters<PricingService['update']>[2];
  const update = (value: string, etag?: string) => service.update('sample', 'org', user, { url: value }, {},
    etag ? { precondition: parseIfMatch(etag) } : undefined);
  return { pricingId, repository, started, resume, update, read: () => reader.showWithEtag('sample', 'org', user), currentUrl: () => url };
}

describe('Pricing revisions while a write is in flight', () => {
  it.each([
    { conditional: true, initialLookupEmpty: false },
    { conditional: false, initialLookupEmpty: false },
    { conditional: true, initialLookupEmpty: true },
  ])('does not expose unfinished content (conditional: $conditional, identity appears during read: $initialLookupEmpty)', async ({ conditional, initialLookupEmpty }) => {
    const f = fixture();
    const first = f.update('first writer', conditional ? `"${f.pricingId}.0"` : undefined);
    await f.started.promise;
    if (initialLookupEmpty) f.repository.findRevisionsBySlug.mockResolvedValueOnce(new Map());
    let readFinished = false;
    const reading = f.read().then(result => { readFinished = true; return result; });
    try {
      await setImmediate();
      expect(readFinished).toBe(false);
      f.resume.resolve();
      await first;
      const snapshot = await reading;
      expect(snapshot.pricing).toMatchObject({ url: 'first writer' });
      await f.update('second writer', snapshot.etag);
      expect(f.currentUrl()).toBe('second writer');
    } finally {
      f.resume.resolve();
      await Promise.allSettled([first, reading]);
    }
  });

  it('releases the pricing after a write fails, so it remains readable and editable', async () => {
    const f = fixture();
    f.repository.update.mockRejectedValueOnce(new Error('storage failed'));
    await expect(f.update('failed writer', `"${f.pricingId}.0"`)).rejects.toThrow('storage failed');
    const snapshot = await f.read();
    expect(snapshot.pricing).toMatchObject({ url: 'original' });
    await f.update('recovered writer', snapshot.etag);
    expect(f.currentUrl()).toBe('recovered writer');
  });
});
