import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn(),
  },
}));

vi.mock('../../main/services/FileService', () => ({
  processFileUris: vi.fn(),
}));

import container from '../../main/config/container';
import PricingCollectionService from '../../main/services/PricingCollectionService';

function createMockCollectionRepo() {
  return {
    findById: vi.fn(),
    findByOrganizationAndSlug: vi.fn(),
    findCollectionPricingsByOrganization: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateAnalytics: vi.fn(),
    setCollectionAnalytics: vi.fn(),
    findAll: vi.fn(),
    destroy: vi.fn(),
    destroyWithPricings: vi.fn(),
  };
}

function createMockPricingRepo() {
  return {
    findOne: vi.fn(),
    create: vi.fn(),
    addPricingsToCollection: vi.fn(),
    removePricingFromCollection: vi.fn(),
    removePricingsFromCollection: vi.fn(),
  };
}

function createMockPermissionService() {
  return {
    resolveOrgRole: vi.fn().mockResolvedValue('OWNER'),
    buildBatchContext: vi.fn().mockResolvedValue({
      entityPermissions: new Map(),
      orgPermissions: new Map(),
    }),
    grantEntityPermission: vi.fn(),
  };
}

function createMockUserService() {
  return {
    findById: vi.fn(),
  };
}

function createMockOrganizationService() {
  return {
    findById: vi.fn(),
  };
}

function setupServiceMocks(overrides: Record<string, any> = {}) {
  const collectionRepo = createMockCollectionRepo();
  const pricingRepo = createMockPricingRepo();
  const permissionService = createMockPermissionService();
  const userService = createMockUserService();
  const organizationService = createMockOrganizationService();

  const mockResolve = vi.fn((name: string) => {
    const map: Record<string, any> = {
      pricingCollectionRepository: collectionRepo,
      pricingRepository: pricingRepo,
      permissionService,
      userService,
      organizationService,
    };
    return map[name] ?? null;
  });

  (container.resolve as any).mockImplementation(mockResolve);

  const service = new PricingCollectionService();

  return {
    service,
    collectionRepo,
    pricingRepo,
    permissionService,
    userService,
    organizationService,
    ...overrides,
  };
}

function makePricingDoc(overrides: Record<string, any> = {}) {
  return {
    name: 'TestPricing',
    slug: 'test-pricing',
    version: '1.0',
    createdAt: new Date('2024-01-15'),
    analytics: {
      numberOfPlans: 5,
      numberOfAddOns: 2,
      numberOfFeatures: 20,
      configurationSpaceSize: 100,
    },
    ...overrides,
  };
}

function makeCollection(overrides: Record<string, any> = {}) {
  return {
    id: 'col123',
    slug: 'test-collection',
    name: 'Test Collection',
    organization: { id: 'org123', name: 'TestOrg', displayName: 'Test Org', avatar: '' },
    analytics: {
      evolutionOfPlans: { dates: [], values: [] },
      evolutionOfAddOns: { dates: [], values: [] },
      evolutionOfFeatures: { dates: [], values: [] },
      evolutionOfConfigurationSpaceSize: { dates: [], values: [] },
    },
    ...overrides,
  };
}

describe('PricingCollectionService._computeCollectionAnalytics', () => {
  let service: PricingCollectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = setupServiceMocks();
    service = mocks.service;
  });

  it('should compute correct averages from a flat array of pricings (data from findCollectionPricingsByOrganization)', () => {
    const pricing1 = makePricingDoc({
      analytics: {
        numberOfPlans: 4,
        numberOfAddOns: 2,
        numberOfFeatures: 15,
        configurationSpaceSize: 80,
      },
    });
    const pricing2 = makePricingDoc({
      analytics: {
        numberOfPlans: 6,
        numberOfAddOns: 4,
        numberOfFeatures: 25,
        configurationSpaceSize: 120,
      },
    });

    const collection = makeCollection({
      pricings: [pricing1, pricing2],
    });

    const result = (service as any)._computeCollectionAnalytics(collection);

    expect(result.evolutionOfPlans.value).toBe(5);
    expect(result.evolutionOfAddOns.value).toBe(3);
    expect(result.evolutionOfFeatures.value).toBe(20);
    expect(result.evolutionOfConfigurationSpaceSize.value).toBe(100);
    expect(result.evolutionOfPlans.date).toBeDefined();
  });

  it('should return zeros when pricings array is empty (collection with no pricings)', () => {
    const collection = makeCollection({
      pricings: [],
    });

    const result = (service as any)._computeCollectionAnalytics(collection);

    expect(result.evolutionOfPlans.value).toBe(0);
    expect(result.evolutionOfAddOns.value).toBe(0);
    expect(result.evolutionOfFeatures.value).toBe(0);
    expect(result.evolutionOfConfigurationSpaceSize.value).toBe(0);
  });

  it('should return zeros when pricings is undefined (fallback from findById)', () => {
    const collection = makeCollection({
      pricings: undefined,
    });

    const result = (service as any)._computeCollectionAnalytics(collection);

    expect(result.evolutionOfPlans.value).toBe(0);
    expect(result.evolutionOfAddOns.value).toBe(0);
    expect(result.evolutionOfFeatures.value).toBe(0);
    expect(result.evolutionOfConfigurationSpaceSize.value).toBe(0);
  });

  it('should handle single pricing correctly', () => {
    const pricing = makePricingDoc({
      analytics: {
        numberOfPlans: 3,
        numberOfAddOns: 1,
        numberOfFeatures: 10,
        configurationSpaceSize: 50,
      },
    });

    const collection = makeCollection({
      pricings: [pricing],
    });

    const result = (service as any)._computeCollectionAnalytics(collection);

    expect(result.evolutionOfPlans.value).toBe(3);
    expect(result.evolutionOfAddOns.value).toBe(1);
    expect(result.evolutionOfFeatures.value).toBe(10);
    expect(result.evolutionOfConfigurationSpaceSize.value).toBe(50);
  });

  it('should NOT treat pricings[0].pricings as the pricings array (regression test for the bug)', () => {
    const pricingDoc = makePricingDoc();

    const collection = {
      id: 'col123',
      slug: 'test-collection',
      pricings: [pricingDoc],
    };

    const result = (service as any)._computeCollectionAnalytics(collection);

    expect(result.evolutionOfPlans.value).toBe(5);
    expect(result.evolutionOfAddOns.value).toBe(2);
    expect(result.evolutionOfFeatures.value).toBe(20);
    expect(result.evolutionOfConfigurationSpaceSize.value).toBe(100);
  });

  it('should compute correct averages for three pricings', () => {
    const pricings = [
      makePricingDoc({ analytics: { numberOfPlans: 3, numberOfAddOns: 1, numberOfFeatures: 10, configurationSpaceSize: 30 } }),
      makePricingDoc({ analytics: { numberOfPlans: 6, numberOfAddOns: 2, numberOfFeatures: 20, configurationSpaceSize: 60 } }),
      makePricingDoc({ analytics: { numberOfPlans: 9, numberOfAddOns: 3, numberOfFeatures: 30, configurationSpaceSize: 90 } }),
    ];

    const collection = makeCollection({ pricings: pricings });

    const result = (service as any)._computeCollectionAnalytics(collection);

    expect(result.evolutionOfPlans.value).toBe(6);
    expect(result.evolutionOfAddOns.value).toBe(2);
    expect(result.evolutionOfFeatures.value).toBe(20);
    expect(result.evolutionOfConfigurationSpaceSize.value).toBe(60);
  });

  it('should return valid ISO date strings in each evolution entry', () => {
    const collection = makeCollection({
      pricings: [makePricingDoc()],
    });

    const result = (service as any)._computeCollectionAnalytics(collection);

    const keys = ['evolutionOfPlans', 'evolutionOfAddOns', 'evolutionOfFeatures', 'evolutionOfConfigurationSpaceSize'] as const;
    for (const key of keys) {
      expect(result[key].date).toBeDefined();
      expect(new Date(result[key].date).toISOString()).toBe(result[key].date);
    }
  });
});

describe('PricingCollectionService.updateCollectionAnalytics', () => {
  let service: PricingCollectionService;
  let collectionRepo: ReturnType<typeof createMockCollectionRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = setupServiceMocks();
    service = mocks.service;
    collectionRepo = mocks.collectionRepo;
  });

  it('should push computed analytics via updateAnalytics', async () => {
    const pricing = makePricingDoc();
    const collection = makeCollection();

    collectionRepo.findById.mockResolvedValue(collection);
    collectionRepo.findCollectionPricingsByOrganization.mockResolvedValue({
      _id: 'col123',
      pricings: [pricing],
    });
    collectionRepo.updateAnalytics.mockResolvedValue(undefined);

    await (service as any).updateCollectionAnalytics('col123');

    expect(collectionRepo.updateAnalytics).toHaveBeenCalledTimes(1);
    const callArgs = collectionRepo.updateAnalytics.mock.calls[0];
    expect(callArgs[0]).toBe('col123');

    const analyticsEntry = callArgs[1];
    expect(analyticsEntry.evolutionOfPlans.value).toBe(5);
    expect(analyticsEntry.evolutionOfAddOns.value).toBe(2);
    expect(analyticsEntry.evolutionOfFeatures.value).toBe(20);
    expect(analyticsEntry.evolutionOfConfigurationSpaceSize.value).toBe(100);
  });

  it('should push zeros when collection has no pricings', async () => {
    const collection = makeCollection();

    collectionRepo.findById.mockResolvedValue(collection);
    collectionRepo.findCollectionPricingsByOrganization.mockResolvedValue({
      _id: 'col123',
      pricings: [],
    });
    collectionRepo.updateAnalytics.mockResolvedValue(undefined);

    await (service as any).updateCollectionAnalytics('col123');

    expect(collectionRepo.updateAnalytics).toHaveBeenCalledTimes(1);
    const analyticsEntry = collectionRepo.updateAnalytics.mock.calls[0][1];
    expect(analyticsEntry.evolutionOfPlans.value).toBe(0);
    expect(analyticsEntry.evolutionOfAddOns.value).toBe(0);
    expect(analyticsEntry.evolutionOfFeatures.value).toBe(0);
    expect(analyticsEntry.evolutionOfConfigurationSpaceSize.value).toBe(0);
  });

  it('should fallback to findById result when findCollectionPricingsByOrganization returns null', async () => {
    const collection = makeCollection();

    collectionRepo.findById.mockResolvedValue(collection);
    collectionRepo.findCollectionPricingsByOrganization.mockResolvedValue(null);
    collectionRepo.updateAnalytics.mockResolvedValue(undefined);

    await (service as any).updateCollectionAnalytics('col123');

    expect(collectionRepo.updateAnalytics).toHaveBeenCalledTimes(1);
    const analyticsEntry = collectionRepo.updateAnalytics.mock.calls[0][1];
    expect(analyticsEntry.evolutionOfPlans.value).toBe(0);
  });

  it('should throw when collection is not found', async () => {
    collectionRepo.findById.mockResolvedValue(null);

    await expect(
      (service as any).updateCollectionAnalytics('nonexistent')
    ).rejects.toThrow('NOT FOUND: Pricing collection not found');
  });
});
