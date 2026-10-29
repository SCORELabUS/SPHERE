/**
 * Links pricings uploaded in a ZIP before the bulk upload stored their
 * collection (see `src/main/utils/zip-upload-links.ts` for the rules).
 *
 *   npx tsx --tsconfig tsconfig.json scripts/link-zip-uploads-to-collections.ts            # dry run (default)
 *   npx tsx --tsconfig tsconfig.json scripts/link-zip-uploads-to-collections.ts --apply    # link the unambiguous ones
 *
 * Run from `api/` with the API's environment (`.env`: MONGO_*, DATABASE_*,
 * COLLECTIONS_FOLDER), or MONGO_URI / MONGODB_URI set. The dry run changes
 * nothing; `--apply` links only what the dry run lists under "To link", never
 * touches a pricing that already has a collection, and can be run again safely.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { getMongoDBConnectionURI } from '../src/main/config/mongoose';
import { applyZipUploadLinks, describeZipUploadPlan, planZipUploadLinks } from '../src/main/utils/zip-upload-links';

dotenv.config();

async function main() {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter(arg => arg !== '--apply' && arg !== '--dry-run');
  if (unknown.length > 0 || (args.has('--apply') && args.has('--dry-run'))) {
    console.error('Usage: link-zip-uploads-to-collections.ts [--dry-run | --apply]');
    process.exit(2);
  }
  const apply = args.has('--apply');

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || getMongoDBConnectionURI());
  try {
    if (!apply) {
      console.log('Dry run: nothing is changed. Run with --apply to link the pricings under "To link".\n');
      console.log(describeZipUploadPlan(await planZipUploadLinks()));
      return;
    }

    const { default: container } = await import('../src/main/config/container');
    const result = await applyZipUploadLinks({
      log: line => console.log(line),
      onLinked: async collectionId => {
        try {
          await container.resolve('pricingCollectionService').updateCollectionAnalytics(collectionId);
          console.log(`refreshed the analytics of collection ${collectionId}`);
        } catch (err) {
          console.warn(`could not refresh the analytics of collection ${collectionId}: ${(err as Error).message}`);
        }
      },
    });
    const versions = result.linked.reduce((total, entry) => total + entry.updatedVersions, 0);
    console.log(`\nLinked ${result.linked.length} pricing${result.linked.length === 1 ? '' : 's'} (${versions} version${versions === 1 ? '' : 's'}). Left alone:\n`);
    console.log(describeZipUploadPlan({ ...result.plan, link: [] }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
