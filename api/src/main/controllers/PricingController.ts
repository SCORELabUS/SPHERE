import fs from 'fs';
import container from '../config/container';
import PricingService from '../services/PricingService';
import path from 'path';
import { PricingIndexQueryParams, SortByType } from '../types/services/PricingService.js';
import { handleError } from '../utils/users/helpers';

class PricingController {
  private pricingService: PricingService;

  constructor() {
    this.pricingService = container.resolve('pricingService');
    this.index = this.index.bind(this);
    this.indexByOrganization = this.indexByOrganization.bind(this);
    this.indexByAuthenticatedUser = this.indexByAuthenticatedUser.bind(this);
    this.show = this.show.bind(this);
    this.getConfigurationSpace = this.getConfigurationSpace.bind(this);
    this.create = this.create.bind(this);
    this.createVersion = this.createVersion.bind(this);
    this.update = this.update.bind(this);
    this.updateVersion = this.updateVersion.bind(this);
    this.destroyByNameAndOrganization = this.destroyByNameAndOrganization.bind(this);
    this.destroyVersionByNameAndOrganization = this.destroyVersionByNameAndOrganization.bind(this);
  }

  async index(req: any, res: any) {
    try {
      const queryParams: PricingIndexQueryParams = this._transformIndexQueryParams(req.query);

      const pricings = await this.pricingService.index(queryParams, req.user);
      res.json(pricings);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async indexByOrganization(req: any, res: any) {
    try {
      const queryParams: PricingIndexQueryParams = this._transformIndexQueryParams(req.query);

      const pricings = await this.pricingService.indexByOrganizationId(req.params.organizationId, req.user, queryParams);
      res.json(pricings);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async indexByAuthenticatedUser(req: any, res: any) {
    try {
      const queryParams: PricingIndexQueryParams = this._transformIndexQueryParams(req.query);
      const targetUserUsername = req.params.username === 'me' ? req.user.username : req.params.username;

      const pricings = await this.pricingService.indexByUser(targetUserUsername, req.user, queryParams);
      res.json(pricings);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async show(req: any, res: any) {
    try {
      const queryParams = req.query;
      const pricing = await this.pricingService.show(
        req.params.pricingSlug,
        req.params.organizationId,
        req.user,
        queryParams
      );
      res.json(pricing);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async getConfigurationSpace(req: any, res: any) {
    try {
      const [configurationSpace, configurationSpaceSize] =
        await this.pricingService.getConfigurationSpace(req.params.organizationId, req.params.pricingSlug, req.params.pricingVersion, req.user, req.query);
      res.json({
        configurationSpace: configurationSpace,
        configurationSpaceSize: configurationSpaceSize,
      });
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async create(req: any, res: any) {
    try {
      const isPrivate = req.body.private === 'true' || req.body.private === true;
      const collectionId = req.body.collectionId;
      const name = req.body.name;
      const pricing = await this.pricingService.create(
        req.file,
        req.params.organizationId,
        isPrivate,
        req.user,
        collectionId,
        name
      );
      res.json(pricing[0]);
    } catch (err: any) {
      try {
        const file = req.file;
        const directory = path.dirname(file.path);
        if (fs.readdirSync(directory).length === 1) {
          fs.rmSync(directory, { recursive: true });
        } else {
          fs.rmSync(file.path);
        }
        const { status, message } = handleError(err);
        res.status(status).send({ error: message });
      } catch (err) {
        res.status(500).send({ error: (err as Error).message });
      }
    }
  }

  async createVersion(req: any, res: any) {
    try {
      const isPrivate = req.body.private === 'true' || req.body.private === true;
      const collectionId = req.body.collectionId;
      const pricing = await this.pricingService.createVersion(
        req.file,
        req.params.organizationId,
        req.params.pricingSlug,
        isPrivate,
        req.user,
        collectionId
      );
      res.json(pricing[0]);
    } catch (err: any) {
      try {
        const file = req.file;
        const directory = path.dirname(file.path);
        if (fs.readdirSync(directory).length === 1) {
          fs.rmSync(directory, { recursive: true });
        } else {
          fs.rmSync(file.path);
        }
        const { status, message } = handleError(err);
        res.status(status).send({ error: message });
      } catch (err) {
        res.status(500).send({ error: (err as Error).message });
      }
    }
  }

  async update(req: any, res: any) {
    try {
      const queryParams = req.query; 

      const pricing = await this.pricingService.update(
        req.params.pricingSlug,
        req.params.organizationId,
        req.user,
        req.body,
        queryParams
      );
      res.json(pricing);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateVersion(req: any, res: any) {
    try {
      const pricing = await this.pricingService.updateVersion(req.body.pricing);
      res.json(pricing);
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async destroyByNameAndOrganization(req: any, res: any) {
    try {
      const queryParams = req.query;
      const result = await this.pricingService.destroy(
        req.params.pricingSlug,
        req.params.organizationId,
        req.user,
        queryParams
      );
      if (!result) {
        res.status(404).send({ error: 'NOT FOUND: Pricing not found' });
      } else {
        res.status(200).send({ message: 'Pricing deleted successfully' });
      }
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async destroyVersionByNameAndOrganization(req: any, res: any) {
    try {
      const result = await this.pricingService.destroyVersion(
        req.params.pricingSlug,
        req.params.pricingVersion,
        req.params.organizationId,
        req.user
      );
      if (!result) {
        res.status(404).send({ error: 'NOT FOUND: Pricing version not found' });
      } else {
        res.status(200).send({ message: 'Pricing version deleted successfully' });
      }
    } catch (err: any) {
      const {status, message} = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  _transformIndexQueryParams(
    indexQueryParams: Record<string, string>
  ): PricingIndexQueryParams {

    if (indexQueryParams['collection'] && indexQueryParams['excludePricingsInCollection'] === 'true') {
      throw new Error('INVALID DATA: `collection` and `excludePricingsInCollection` cannot be used together');
    }

    const transformedData: PricingIndexQueryParams = {
      name: indexQueryParams.name as string,
      sortBy: indexQueryParams.sortBy as SortByType,
      sort: indexQueryParams.sort === 'asc' ? 'asc' : 'desc',
      subscriptions: {
        min: parseFloat(indexQueryParams['min-subscription'] as string),
        max: parseFloat(indexQueryParams['max-subscription'] as string),
      },
      minPrice: {
        min: parseFloat(indexQueryParams['min-minPrice'] as string),
        max: parseFloat(indexQueryParams['max-minPrice'] as string),
      },
      maxPrice: {
        min: parseFloat(indexQueryParams['max-minPrice'] as string),
        max: parseFloat(indexQueryParams['max-maxPrice'] as string),
      },
      selectedOrganizations: indexQueryParams.selectedOrganizations
        ? (indexQueryParams.selectedOrganizations as string).split(',')
        : undefined,
      collection: indexQueryParams.collection as string,
      excludePricingsInCollection: indexQueryParams.excludePricingsInCollection === 'true',
      limit: parseInt(indexQueryParams.limit) || 10,
      offset: parseInt(indexQueryParams.offset) || 0,
    };

    const optionalFields = [
      'name',
      'subscriptions',
      'minPrice',
      'maxPrice',
      'selectedOrganizations',
      'collection',
      'excludePricingsInCollection',
      'sortBy',
      'sort',
    ] as const;

    optionalFields.forEach(field => {
      if (['name', 'selectedOrganizations', 'sortBy', 'sort', 'collection', 'excludePricingsInCollection'].includes(field)) {
        if (!transformedData[field]) {
          delete transformedData[field];
        }
      } else {
        if (this._containsNaN(transformedData[field]!)) {
          delete transformedData[field];
        }
      }
    });

    return transformedData;
  }

  _containsNaN(attr: any): boolean {
    return Object.values(attr).every(value => Number.isNaN(value));
  }
}

export default PricingController;
