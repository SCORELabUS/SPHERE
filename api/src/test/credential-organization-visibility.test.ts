import { it, expect, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
let yamlFile = '';
afterAll(async () => { if (yamlFile) await fs.rm(yamlFile, { force: true }); for (const f of container.resolve<Set<string>>('generatedFilesToDelete')) await fs.rm(f, {force:true, recursive:true}); await shutdownApp(); });
import request from 'supertest';
import container from './utils/config/testContainer';
import { shutdownApp } from './utils/testApp';
import { createAndLoginUser } from './utils/users/userTestUtils';
import { createTestOrganization } from './utils/organizations';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { BASE_PATH } from './utils/config/variables';
import Pricing from '../main/repositories/mongoose/models/PricingMongoose';
import Notification from '../main/repositories/mongoose/models/NotificationMongoose';
it('limited key must not reveal an unrelated private organization or its contents', async () => {
 const app = container.resolve<any>('app');
 const {user} = await createAndLoginUser('USER');
 const allowed = await createTestOrganization(user.token, {displayName: 'Review Allowed'});
 const secret = await createTestOrganization(user.token, {displayName: 'Review Secret'});
 const pricing = await createPricingForOrganization({organizationId: secret.id, serviceName: 'review-secret-pricing'});
 const doc:any = await Pricing.findById(pricing.id).lean();
 yamlFile = path.resolve(process.cwd(), 'public', doc.yaml);
 const collection = await createTestCollection({_organizationId: secret.id, name: 'Review Secret Collection'});
 await request(app).put(`${BASE_PATH}/orgs/${secret.id}`).set('Authorization', `Bearer ${user.token}`).send({visibility:'private'});
 await Notification.create({_userId:user.id, kind:'PricingUpdated', title: 'review-secret-pricing', message:'secret content', data:{organizationId:secret.id,pricingSlug:pricing.serviceName,version:doc.version}});
 const response = await request(app).post(`${BASE_PATH}/users/${user.username}/api-keys`).set('Authorization', `Bearer ${user.token}`).send({name:'review-key',scopes:[{organizationId:allowed.id,scope:'VIEW'}]});
 expect(response.status).toBe(201);
 const key = response.body.plainKey;
 const results = [];
 for (const route of ['/users/me/orgs','/users/me/pricings','/users/me/collections','/notifications']) {
  const result = await request(app).get(`${BASE_PATH}${route}`).set('x-api-key',key);
  expect(result.status, route).toBe(200);
  results.push({route,status:result.status, leaked: JSON.stringify(result.body).includes('Review Secret') || JSON.stringify(result.body).includes('review-secret-pricing')});
 }
 console.log('REVIEW_SCOPES', JSON.stringify(results));
 expect(results.every(result => !result.leaked)).toBe(true);
}, 60000);
