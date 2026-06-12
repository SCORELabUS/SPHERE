import { TestCollection } from '../../types/Collections';
import PricingCollectionMongoose, { generateSlug } from '../../../main/repositories/mongoose/models/PricingCollectionMongoose';
import { generateSlug as generatePricingSlug } from '../../../main/utils/slug-manager';
import testContainer from '../config/testContainer';
import { createTestUser } from '../users/userTestUtils';
import request from 'supertest';
import { BASE_PATH } from '../config/variables';

export type TestCollectionData = Partial<TestCollection>;

export const createTestCollectionWithPricings = async (params: TestCollectionData, pricings: string[]): Promise<TestCollection> => {
  const collectionData: Partial<TestCollection> = {
    name: params.name || 'Test_Collection_' + Math.random().toString(36).substring(2, 15),
    description: params.description || 'This is a test collection',
    private: params.private || false,
  };

  const pricingSlugs = pricings.map(name => generatePricingSlug(name));

  const payload = {
    ...collectionData,
    pricings: pricingSlugs,
  };

  const organizationId = params._organizationId || (await createTestUser("USER")).organizationId;

  const response = await request(testContainer.resolve('app'))
    .post(`${BASE_PATH}/collections/` + organizationId)
    .set('Authorization', `Bearer ${testContainer.resolve('adminUser').token}`)
    .send(payload);
  
  return response.body;
};

export const createTestCollection = async (params: TestCollectionData): Promise<TestCollection> => {
  const organizationId = params._organizationId || (await createTestUser("USER")).organizationId;

  const collectionName = params.name || 'Test_Collection_' + Math.random().toString(36).substring(2, 15);
  const collectionData: Omit<TestCollection, 'id'> = {
    name: collectionName,
    slug: params.slug || generateSlug(collectionName),
    description: params.description || 'This is a test collection',
    _organizationId: organizationId,
    private: params.private || false,
    analytics: {
      evolutionOfPlans: { dates: [], values: [] },
      evolutionOfAddOns: { dates: [], values: [] },
      evolutionOfFeatures: { dates: [], values: [] },
      evolutionOfConfigurationSpaceSize: { dates: [], values: [] },
    },
  };

  const collection = new PricingCollectionMongoose(collectionData);
  return collection.save().then(savedCollection => {
    testContainer.resolve('collectionIdsToDelete').add(savedCollection._id.toString());
    
    return {
      id: savedCollection._id.toString(),
      ...collectionData,
    };
  });
};

export const createCollectionForOrganization = async (organizationId: string) => {
  const collection = await createTestCollection({ _organizationId: organizationId });

  testContainer.resolve('collectionIdsToDelete').add(collection.id);
  return collection;
};
