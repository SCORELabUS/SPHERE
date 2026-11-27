import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ calculate: vi.fn(), parse: vi.fn() }));
vi.mock('../../main/config/container', () => ({ default: { resolve: () => ({}) } }));
vi.mock('pricing4ts/server', () => ({
  retrievePricingFromText: mocks.parse,
  PricingService: class { getConfigurationSpace = mocks.calculate; },
}));
const { default: Service } = await import('../../main/services/PricingAnonymousLinkService');
const shared = { file: Buffer.from('yaml'), pricing: { analytics: {}, version: '1', createdAt: new Date(), yaml: 'yaml' } };

describe('anonymous configuration space', () => {
  it('returns only configuration fields and checks the link after calculation', async () => {
    const service = new Service();
    service.resolve = vi.fn().mockResolvedValue(shared);
    mocks.calculate.mockResolvedValue([{ selectedPlan: 'basic', selectedAddons: [], subscriptionFeatures: [], subscriptionUsageLimits: [], subscriptionCost: 1, organization: 'secret' }]);
    const result = await service.configurationSpace('token', 200, 0);
    expect(service.resolve).toHaveBeenCalledTimes(2);
    expect(result?.configurationSpace[0]).not.toHaveProperty('organization');
  });
  it('returns nothing if the link is revoked during calculation', async () => {
    const service = new Service();
    service.resolve = vi.fn().mockResolvedValueOnce(shared).mockResolvedValueOnce(null);
    mocks.calculate.mockResolvedValue([]);
    expect(await service.configurationSpace('token', 200, 0)).toBeNull();
  });
  it('keeps the dead-feature diagnosis without exposing internal errors', async () => {
    const service = new Service();
    service.resolve = vi.fn().mockResolvedValue(shared);
    mocks.calculate.mockRejectedValueOnce(new Error('DeadFeatureError: details'));
    await expect(service.configurationSpace('token', 200, 0)).rejects.toThrow('DeadFeatureError');
    mocks.calculate.mockRejectedValueOnce(new Error('secret path'));
    await expect(service.configurationSpace('token', 200, 0)).rejects.toThrow('Configuration space could not be calculated');
  });
});
