import type { Connection } from 'mongoose';

export async function up(connection: Connection): Promise<void> {
  const pricingsCollection = connection.collection('pricings');
  const pricingCollectionsCollection = connection.collection('pricingCollections');

  // Step 1: For each pricing document with an "owner" field, look up the user's personal organization
  // and set _organizationId from it, then remove the "owner" field
  const pricingsWithOwner = await pricingsCollection.find({ owner: { $exists: true } }).toArray();
  const usersCollection = connection.collection('users');
  const orgsCollection = connection.collection('organizations');

  for (const pricing of pricingsWithOwner) {
    const user = await usersCollection.findOne({ username: pricing.owner });
    if (user) {
      const personalOrg = await orgsCollection.findOne({
        name: user.username,
        isPersonal: true,
      });
      if (personalOrg) {
        await pricingsCollection.updateOne(
          { _id: pricing._id },
          {
            $set: { _organizationId: personalOrg._id },
            $unset: { owner: 1 },
          }
        );
      }
    }
  }

  // Step 2: For each pricingCollection document with "_ownerName" field, look up the user's
  // personal organization and set _organizationId from it, then remove "_ownerName"
  const collectionsWithOwner = await pricingCollectionsCollection
    .find({ _ownerName: { $exists: true } })
    .toArray();

  for (const collection of collectionsWithOwner) {
    const user = await usersCollection.findOne({ username: collection._ownerName });
    if (user) {
      const personalOrg = await orgsCollection.findOne({
        name: user.username,
        isPersonal: true,
      });
      if (personalOrg) {
        await pricingCollectionsCollection.updateOne(
          { _id: collection._id },
          {
            $set: { _organizationId: personalOrg._id },
            $unset: { _ownerName: 1 },
          }
        );
      }
    }
  }

  // Step 3: Drop old indexes and create new ones

  // Pricings: drop old index, create new
  const pricingIndexes = await pricingsCollection.indexes();
  const oldPricingIndex = pricingIndexes.some(
    (index) => index.name === 'name_1_owner_1_version_1__collectionId_1__organizationId_1'
  );
  if (oldPricingIndex) {
    await pricingsCollection.dropIndex(
      'name_1_owner_1_version_1__collectionId_1__organizationId_1'
    );
  }
  const oldPricingIndex2 = pricingIndexes.some(
    (index) => index.name === 'name_1_owner_1_version_1__collectionId_1'
  );
  if (oldPricingIndex2) {
    await pricingsCollection.dropIndex('name_1_owner_1_version_1__collectionId_1');
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

  // PricingCollections: drop old index, create new
  const collectionIndexes = await pricingCollectionsCollection.indexes();
  const oldCollectionIndex = collectionIndexes.some(
    (index) => index.name === 'name_1__ownerName_1__organizationId_1'
  );
  if (oldCollectionIndex) {
    await pricingCollectionsCollection.dropIndex('name_1__ownerName_1__organizationId_1');
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
  const pricingsCollection = connection.collection('pricings');
  const pricingCollectionsCollection = connection.collection('pricingCollections');
  const usersCollection = connection.collection('users');
  const orgsCollection = connection.collection('organizations');

  // Reverse: for each pricing with _organizationId, look up the org name (which is the username)
  // and set owner back
  const pricingsWithOrg = await pricingsCollection
    .find({ _organizationId: { $exists: true } })
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

  // Reverse: for each pricingCollection with _organizationId, set _ownerName back
  const collectionsWithOrg = await pricingCollectionsCollection
    .find({ _organizationId: { $exists: true } })
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

  // Restore old indexes
  const pricingIndexes = await pricingsCollection.indexes();
  const newPricingIndex = pricingIndexes.some(
    (index) => index.name === 'name_1__organizationId_1_version_1__collectionId_1'
  );
  if (newPricingIndex) {
    await pricingsCollection.dropIndex('name_1__organizationId_1_version_1__collectionId_1');
  }

  const oldPricingIndexExists = pricingIndexes.some(
    (index) => index.name === 'name_1_owner_1_version_1__collectionId_1__organizationId_1'
  );
  if (!oldPricingIndexExists) {
    await pricingsCollection.createIndex(
      { name: 1, owner: 1, version: 1, _collectionId: 1, _organizationId: 1 },
      { unique: true }
    );
  }

  const collectionIndexes = await pricingCollectionsCollection.indexes();
  const newCollectionIndex = collectionIndexes.some(
    (index) => index.name === 'name_1__organizationId_1'
  );
  if (newCollectionIndex) {
    await pricingCollectionsCollection.dropIndex('name_1__organizationId_1');
  }

  const oldCollectionIndexExists = collectionIndexes.some(
    (index) => index.name === 'name_1__ownerName_1__organizationId_1'
  );
  if (!oldCollectionIndexExists) {
    await pricingCollectionsCollection.createIndex(
      { name: 1, _ownerName: 1, _organizationId: 1 },
      { unique: true }
    );
  }
}
