import mongoose from 'mongoose';

export async function up(db: mongoose.Connection) {
  const groups = await db.collection('pricings').aggregate([
    { $group: { _id: { name: '$name', org: '$_organizationId', collection: { $ifNull: ['$_collectionId', null] } },
      docs: { $push: { _id: '$_id', slug: '$slug', version: '$version', pricingId: '$pricingId' } } } },
  ]).toArray();
  const locators = new Set<string>();
  const assignedIds = new Set<string>();
  for (const group of groups) {
    const docs = group.docs;
    const locator = JSON.stringify([String(group._id.org), docs[0].slug, group._id.collection]);
    if (!group._id.org || !docs[0].slug || locators.has(locator) ||
        new Set(docs.map((d: any) => d.version)).size !== docs.length ||
        new Set(docs.map((d: any) => d.slug)).size !== 1 ||
        new Set(docs.filter((d: any) => d.pricingId).map((d: any) => String(d.pricingId))).size > 1) {
      throw new Error('Ambiguous pricing family; repair data before identity migration');
    }
    const priorId = docs.find((d: any) => d.pricingId)?.pricingId;
    if (priorId && assignedIds.has(String(priorId))) throw new Error('Ambiguous identity shared by different pricing families');
    if (priorId) assignedIds.add(String(priorId));
    locators.add(locator);
  }
  for (const { docs, _id } of groups) {
    const locator = { _organizationId: _id.org, slug: docs[0].slug, _collectionId: _id.collection, deleted: false };
    const existing = await db.collection('pricingIdentities').findOne(locator);
    const pricingId = docs.find((d: any) => d.pricingId)?.pricingId ?? existing?._id ?? new mongoose.Types.ObjectId();
    await db.collection('pricingIdentities').updateOne({ _id: pricingId }, { $set: { ...locator, name: _id.name } }, { upsert: true });
    await db.collection('pricings').updateMany({ _id: { $in: docs.map((d: any) => d._id) } }, { $set: { pricingId } });
  }
  if (await db.collection('pricings').countDocuments({ pricingId: null })) throw new Error('Orphan pricing versions');
  await db.collection('pricings').createIndex({ pricingId: 1, version: 1 }, { unique: true, partialFilterExpression: { pricingId: { $type: 'objectId' } } });
  await db.collection('pricingIdentities').createIndex({ _organizationId: 1, slug: 1, _collectionId: 1 }, { unique: true, partialFilterExpression: { deleted: false } });
}
export async function down() {
  throw new Error('Permanent identities must not be removed after publishing links. Roll back application code only.');
}
