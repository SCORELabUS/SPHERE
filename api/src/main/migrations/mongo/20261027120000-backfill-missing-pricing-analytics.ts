import fs from 'fs';
import path from 'path';
import { type Connection } from 'mongoose';
import { PricingService as PricingAnalytics, retrievePricingFromText } from 'pricing4ts/server';
import PricingMongoose from '../../repositories/mongoose/models/PricingMongoose';
import { storableAnalytics } from '../../repositories/mongoose/PricingRepository';

/**
 * Publishing used to store a version's analytics without waiting for it, so a
 * failed save (e.g. a NaN price) left the version with none. Such versions broke
 * their collection's analytics, and with them adding pricings to the collection.
 * Recomputes them from each version's YAML; a version that still cannot be
 * analysed is left as it is, which collections now tolerate.
 */
export async function up(connection: Connection): Promise<void> {
  const Pricing = connection.models.Pricing || connection.model('Pricing', PricingMongoose.schema, 'pricings');
  const staticFolder = process.env.SERVER_STATICS_FOLDER || 'public/';

  const versions = await Pricing.collection
    .find({ $or: [{ analytics: { $exists: false } }, { analytics: null }] }, { projection: { yaml: 1 } })
    .toArray();

  for (const version of versions) {
    try {
      // Parsed from text: retrievePricingFromPath can rewrite the file it reads.
      const yamlPath = path.resolve(staticFolder, String(version.yaml));
      const pricing = retrievePricingFromText(fs.readFileSync(yamlPath, 'utf8'));
      const analytics = await new PricingAnalytics(pricing).getAnalytics();
      await Pricing.collection.updateOne({ _id: version._id }, { $set: { analytics: storableAnalytics(analytics) } });
    } catch (err) {
      console.warn(`Could not compute the analytics of pricing version ${version._id}: ${(err as Error).message}`);
    }
  }
}

export async function down(): Promise<void> {
  // The recomputed analytics are correct data: nothing to undo.
}
