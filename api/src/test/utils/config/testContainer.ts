// deno-lint-ignore-file no-explicit-any
import { createContainer, asValue, AwilixContainer } from 'awilix';
import dotenv from 'dotenv';
import { getApp } from '../testApp';
import { createGlobalAdminUser, createGlobalTestUser } from '../helpers';

dotenv.config();

async function initTestContainer(): Promise<AwilixContainer> {
  const container: AwilixContainer = createContainer();
  container.register({
    app: asValue(await getApp()),
    usersToDelete: asValue(new Set<string>()),
    pricingsToDelete: asValue(new Set<string>()),
    generatedFilesToDelete: asValue(new Set<string>()),
    collectionIdsToDelete: asValue(new Set<string>()),
    orgsToDelete: asValue(new Set<string>()),
    membershipsToDelete: asValue(new Set<string>()),
    invitationsToDelete: asValue(new Set<string>()),
    adminUser: asValue(await createGlobalAdminUser()),
    testUser: asValue(await createGlobalTestUser()),
  });
  return container;
}

let container: AwilixContainer | null = null;
if (!container) {
  container = await initTestContainer();
}

export default container as AwilixContainer;
