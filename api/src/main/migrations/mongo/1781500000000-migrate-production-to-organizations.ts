import { type Connection } from 'mongoose';
import OrganizationMongoose from '../../repositories/mongoose/models/OrganizationMongoose';
import OrganizationMembershipMongoose from '../../repositories/mongoose/models/OrganizationMembershipMongoose';

export async function up(connection: Connection): Promise<void> {
  const usersCollection = connection.collection('users');
  const orgsCollection = connection.collection('organizations');
  const membershipsCollection = connection.collection('organizationMemberships');
  const pricingsCollection = connection.collection('pricings');
  const pricingCollectionsCollection = connection.collection('pricingCollections');

  // Step 1: Create personal organizations for every user that doesn't have one
  const users = await usersCollection.find({}).toArray();
  const userOrgMap = new Map<string, string>(); // username -> orgId

  for (const user of users) {
    const existingOrg = await orgsCollection.findOne({
      name: user.username,
      isPersonal: true,
    });

    if (existingOrg) {
      userOrgMap.set(user.username, existingOrg._id.toString());
      continue;
    }

    const Organization = connection.models.Organization ||
      connection.model('Organization', OrganizationMongoose.schema, 'organizations');

    const newOrg = await Organization.create({
      name: user.username,
      displayName: user.username,
      description: null,
      avatar: null,
      _parentId: null,
      ancestors: [],
      isPersonal: true,
    });

    userOrgMap.set(user.username, newOrg._id.toString());
  }

  // Step 2: Create OWNER memberships for each user in their personal organization
  const OrganizationMembership = connection.models.OrganizationMembership ||
    connection.model('OrganizationMembership', OrganizationMembershipMongoose.schema, 'organizationMemberships');

  for (const user of users) {
    const orgId = userOrgMap.get(user.username);
    if (!orgId) continue;

    const existingMembership = await membershipsCollection.findOne({
      _userId: user._id,
      _organizationId: orgId,
    });

    if (!existingMembership) {
      await OrganizationMembership.create({
        _userId: user._id,
        _organizationId: orgId,
        role: 'OWNER',
        _roleWeight: 3,
        joinedAt: user.createdAt || new Date(),
      });
    }
  }

  // Step 3: Convert pricings - replace owner (username string) with _organizationId (ObjectId)
  const pricingsWithOwner = await pricingsCollection
    .find({ owner: { $exists: true, $ne: null } })
    .toArray();

  for (const pricing of pricingsWithOwner) {
    const orgId = userOrgMap.get(pricing.owner);
    if (orgId) {
      await pricingsCollection.updateOne(
        { _id: pricing._id },
        {
          $set: { _organizationId: orgId },
          $unset: { owner: 1 },
        }
      );
    }
  }

  // Step 4: Convert pricingCollections - replace _ownerName (username string) with _organizationId (ObjectId)
  const collectionsWithOwner = await pricingCollectionsCollection
    .find({ _ownerName: { $exists: true, $ne: null } })
    .toArray();

  for (const collection of collectionsWithOwner) {
    const orgId = userOrgMap.get(collection._ownerName);
    if (orgId) {
      await pricingCollectionsCollection.updateOne(
        { _id: collection._id },
        {
          $set: { _organizationId: orgId },
          $unset: { _ownerName: 1 },
        }
      );
    }
  }

  // Step 5: Rebuild indexes for pricings
  const pricingIndexes = await pricingsCollection.indexes();

  const oldPricingIndexes = [
    'name_1_owner_1_version_1__collectionId_1__organizationId_1',
    'name_1_owner_1_version_1__collectionId_1',
    'name_1_version_1_owner_1',
  ];

  for (const indexName of oldPricingIndexes) {
    const exists = pricingIndexes.some((index) => index.name === indexName);
    if (exists) {
      await pricingsCollection.dropIndex(indexName);
    }
  }

  const newPricingIndexExists = pricingIndexes.some(
    (index) => index.name === 'name_1__organizationId_1_version_1__collectionId_1'
  );
  if (!newPricingIndexExists) {
    await pricingsCollection.createIndex(
      { name: 1, _organizationId: 1, version: 1, _collectionId: 1 },
      { unique: true }
    );
  }

  // Step 6: Rebuild indexes for pricingCollections
  const collectionIndexes = await pricingCollectionsCollection.indexes();

  const oldCollectionIndexes = [
    'name_1__ownerName_1__organizationId_1',
    'name_1__ownerName_1',
    'name_1_owner_1',
  ];

  for (const indexName of oldCollectionIndexes) {
    const exists = collectionIndexes.some((index) => index.name === indexName);
    if (exists) {
      await pricingCollectionsCollection.dropIndex(indexName);
    }
  }

  const newCollectionIndexExists = collectionIndexes.some(
    (index) => index.name === 'name_1__organizationId_1'
  );
  if (!newCollectionIndexExists) {
    await pricingCollectionsCollection.createIndex(
      { name: 1, _organizationId: 1 },
      { unique: true }
    );
  }
}

export async function down(connection: Connection): Promise<void> {
  const usersCollection = connection.collection('users');
  const orgsCollection = connection.collection('organizations');
  const membershipsCollection = connection.collection('organizationMemberships');
  const pricingsCollection = connection.collection('pricings');
  const pricingCollectionsCollection = connection.collection('pricingCollections');

  // Step 1: Restore owner field in pricings from organization name
  const pricingsWithOrg = await pricingsCollection
    .find({ _organizationId: { $exists: true, $ne: null } })
    .toArray();

  for (const pricing of pricingsWithOrg) {
    const org = await orgsCollection.findOne({ _id: pricing._organizationId });
    if (org) {
      await pricingsCollection.updateOne(
        { _id: pricing._id },
        {
          $set: { owner: org.name },
          $unset: { _organizationId: 1 },
        }
      );
    }
  }

  // Step 2: Restore _ownerName field in pricingCollections from organization name
  const collectionsWithOrg = await pricingCollectionsCollection
    .find({ _organizationId: { $exists: true, $ne: null } })
    .toArray();

  for (const collection of collectionsWithOrg) {
    const org = await orgsCollection.findOne({ _id: collection._organizationId });
    if (org) {
      await pricingCollectionsCollection.updateOne(
        { _id: collection._id },
        {
          $set: { _ownerName: org.name },
          $unset: { _organizationId: 1 },
        }
      );
    }
  }

  // Step 3: Restore old indexes for pricings
  const pricingIndexes = await pricingsCollection.indexes();

  const newPricingIndex = pricingIndexes.some(
    (index) => index.name === 'name_1__organizationId_1_version_1__collectionId_1'
  );
  if (newPricingIndex) {
    await pricingsCollection.dropIndex('name_1__organizationId_1_version_1__collectionId_1');
  }

  const oldPricingIndexExists = pricingIndexes.some(
    (index) => index.name === 'name_1_owner_1_version_1__collectionId_1'
  );
  if (!oldPricingIndexExists) {
    await pricingsCollection.createIndex(
      { name: 1, owner: 1, version: 1, _collectionId: 1 },
      { unique: true }
    );
  }

  // Step 4: Restore old indexes for pricingCollections
  const collectionIndexes = await pricingCollectionsCollection.indexes();

  const newCollectionIndex = collectionIndexes.some(
    (index) => index.name === 'name_1__organizationId_1'
  );
  if (newCollectionIndex) {
    await pricingCollectionsCollection.dropIndex('name_1__organizationId_1');
  }

  const oldCollectionIndexExists = collectionIndexes.some(
    (index) => index.name === 'name_1__ownerName_1'
  );
  if (!oldCollectionIndexExists) {
    await pricingCollectionsCollection.createIndex(
      { name: 1, _ownerName: 1 },
      { unique: true }
    );
  }

  // Step 5: Remove memberships created by this migration (personal org memberships)
  const personalOrgIds = await orgsCollection
    .find({ isPersonal: true })
    .toArray()
    .then((orgs) => orgs.map((org) => org._id));

  await membershipsCollection.deleteMany({
    _organizationId: { $in: personalOrgIds },
    role: 'OWNER',
  });

  // Step 6: Remove personal organizations created by this migration
  await orgsCollection.deleteMany({ isPersonal: true });
}
