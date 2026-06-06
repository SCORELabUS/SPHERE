import container from '../config/container';
import PricingCollectionService from '../services/PricingCollectionService.js';
import PricingService from '../services/PricingService.js';
import { CollectionIndexQueryParams } from '../types/services/PricingCollection.js';
import path from 'path';
import archiver from 'archiver';
import { handleError } from '../utils/users/helpers';

class PricingCollectionController {
  private readonly pricingCollectionService: PricingCollectionService;
  private readonly pricingService: PricingService;

  constructor() {
    this.pricingCollectionService = container.resolve('pricingCollectionService');
    this.pricingService = container.resolve('pricingService');
    this.index = this.index.bind(this);
    this.indexByOrganizationId = this.indexByOrganizationId.bind(this);
    this.indexByAuthenticatedUser = this.indexByAuthenticatedUser.bind(this);
    this.show = this.show.bind(this);
    this.downloadCollection = this.downloadCollection.bind(this);
    this.create = this.create.bind(this);
    this.bulkCreate = this.bulkCreate.bind(this);
    this.addPricingToCollection = this.addPricingToCollection.bind(this);
    // this.generateAnalytics = this.generateAnalytics.bind(this);
    this.update = this.update.bind(this);
    this.destroy = this.destroy.bind(this);
    this.removePricingFromCollection = this.removePricingFromCollection.bind(this);

  }

  async index(req: any, res: any) {
    try {
      const queryParams: CollectionIndexQueryParams = this._transformIndexQueryParams(req.query);

      const result = await this.pricingCollectionService.index(queryParams);
      // result contains { collections, total }
      res.json(result);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async indexByAuthenticatedUser(req: any, res: any) {
    try {
          const queryParams: CollectionIndexQueryParams = this._transformIndexQueryParams(req.query);
          const targetUserUsername = req.params.username === 'me' ? req.user.username : req.params.username;

          const pricings = await this.pricingCollectionService.indexByUser(targetUserUsername, req.user, queryParams);
          res.json(pricings);
        } catch (err: any) {
          const {status, message} = handleError(err);
          res.status(status).send({ error: message });
        }
  }

  async show(req: any, res: any) {
    try {
      const collection = await this.pricingCollectionService.show(
        req.params.organizationId,
        req.params.collectionSlug,
        req.user
      );
      res.json(collection);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async indexByOrganizationId(req: any, res: any) {
    try {
      const queryParams: CollectionIndexQueryParams = this._transformIndexQueryParams(req.query);
      const collections = await this.pricingCollectionService.indexByOrganizationId(req.params.organizationId, req.user, queryParams);
      res.json(collections);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async downloadCollection(req: any, res: any) {
    try {
      const collectionSlug = req.params.collectionSlug;
      const organizationId = req.params.organizationId;
      const collection = await this.pricingCollectionService.show(
        organizationId,
        collectionSlug,
        req.user
      );
      const pricings = await this.pricingService.indexByCollection(collection.id);
      const pricingsToDownload = pricings.map(pricing => pricing.yaml);

      if (pricingsToDownload.length === 0) {
        res.status(400).send({ error: 'No pricings to download.' });
        return;
      }

      const zipFileName = `${collectionSlug}.zip`;
      res.setHeader('Content-Disposition', `attachment; filename=${zipFileName}`);
      res.setHeader('Content-Type', 'application/zip');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => {
        console.error('❌ ERROR with archiver:', err);
        res.status(500).send({ error: 'Error generating the ZIP.' });
      });

      // Event that confirms when the zip has been generated and closes the connection
      archive.on('end', () => {
        res.end();
      });

      archive.pipe(res);

      if (!process.env.COLLECTIONS_FOLDER) {
        throw new Error('Collections folder not defined in the environment.');
      }

      const baseDir = 'public';

      pricingsToDownload.forEach(pricingPath => {
        const relativePath = path.join(baseDir, pricingPath);
        const pathParts = pricingPath.split('/');
        const pricingName = pathParts[3];
        const pricingFileName = pathParts[pathParts.length - 1];

        archive.file(relativePath, {
          name: path.posix.join(pricingName, pricingFileName),
        });
      });

      archive.on('error', (err: any) => {
        throw new Error(err);
      });
      archive.finalize();

    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async create(req: any, res: any) {
    try {
      const pricing = await this.pricingCollectionService.create(
        req.body,
        req.params.organizationId,
        req.user
      );
      res.status(201).json(pricing);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async bulkCreate(req: any, res: any) {
    try {
      const [collection, pricingsWithErrors] = await this.pricingCollectionService.bulkCreate(
        req.file,
        req.body,
        req.params.organizationId,
        req.user
      );
      res.status(201).json({collection, pricingsWithErrors});
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async addPricingToCollection(req: any, res: any) {
    try {

      const queryParams = req.query;

      const result = await this.pricingService.addPricingToCollection(
        req.body.pricingName,
        req.org.id,
        req.body.collectionId,
        queryParams
      );

      if (!result) {
        res.status(404).send({ error: 'ERROR: Pricing not found or you are not a member of the organization' });
      }
      
      res.json({ message: "Pricing added to collection successfully" });
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async update(req: any, res: any) {
    try {
      const collection = await this.pricingCollectionService.update(
        req.params.organizationId,
        req.params.collectionSlug,
        req.body,
        req.user
      );
      await this.pricingService.updatePricingsCollectionName(
        req.params.collectionSlug,
        collection.name,
        collection.id
      );
      res.json(collection);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async destroy(req: any, res: any) {
    try {
      const { cascade } = req.query;
      const deleteCascade = String(cascade).toLowerCase() === 'true';

      const result = await this.pricingCollectionService.destroy(
        req.params.organizationId,
        req.params.collectionSlug,
        deleteCascade,
        false,
        req.user
      );
      const message = result ? 'Successfully deleted.' : 'Could not delete collection.';
      res.status(204).json({ message: message });
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async removePricingFromCollection(req: any, res: any) {
    try {
      await this.pricingCollectionService.removePricingFromCollection(
        req.params.pricingSlug,
        req.params.organizationId,
        req.params.collectionSlug,
        req.user
      );
      res.json({message: 'Pricing removed from collection successfully.'});
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }



  _transformIndexQueryParams(indexQueryParams: Record<string, string>): CollectionIndexQueryParams {
    const transformedData: CollectionIndexQueryParams = {
      name: indexQueryParams.name,
      sortBy: indexQueryParams.sortBy,
      sort: indexQueryParams.sort ?? 'asc',
      organizationIds: indexQueryParams.organizationIds ? indexQueryParams.organizationIds.split(',') : undefined,
      limit: parseInt(indexQueryParams.limit) || 10,
      offset: parseInt(indexQueryParams.offset) || 0,
    };

    const optionalFields = ['name', 'sortBy', 'sort', 'organizationIds'] as const;

    optionalFields.forEach(field => {
      if (!transformedData[field]) {
        delete transformedData[field];
      }
    });

    return transformedData;
  }
}

export default PricingCollectionController;
