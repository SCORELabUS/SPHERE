import fs from 'fs';
import container from '../config/container';
import PricingService from '../services/PricingService';
import path from 'path';
import { PricingIndexQueryParams, SortByType } from '../types/services/PricingService.js';
import { handleError } from '../utils/users/helpers';
import {
  isIfMatchRequired,
  parseIfMatch,
  PreconditionFailedError,
  PricingRevisionContext,
} from '../utils/pricing-etag';

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
    this.fork = this.fork.bind(this);
    this.update = this.update.bind(this);
    this.updateVersionVisibility = this.updateVersionVisibility.bind(this);
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
      const { pricing, etag } = await this.pricingService.showWithEtag(
        req.params.pricingSlug,
        req.params.organizationId,
        req.user,
        queryParams
      );
      // The ETag names the pricing's revision, not this body (which also depends on
      // the caller and on the organization), so it must not validate a cached copy.
      res.set('Cache-Control', 'no-store');
      if (etag) res.set('ETag', etag);
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
      const revision = this.revisionContext(req);
      const pricing = await this.pricingService.create(
        req.file,
        req.params.organizationId,
        isPrivate,
        req.user,
        collectionId,
        name,
        revision
      );
      this.sendWithEtag(res, revision, pricing[0]);
    } catch (err: any) {
      this.cleanupUploadedFile(req.file);
      this.sendError(res, err);
    }
  }

  async createVersion(req: any, res: any) {
    try {
      const isPrivate = req.body.private === 'true' || req.body.private === true;
      const collectionId = req.body.collectionId;
      const createdAt = this.parseCreatedAt(req.body.createdAt);
      // Adding a version overwrites nothing, so If-Match is honoured here but never required.
      const revision = this.revisionContext(req);
      const pricing = await this.pricingService.createVersion(
        req.file,
        req.params.organizationId,
        req.params.pricingSlug,
        isPrivate,
        req.user,
        collectionId,
        createdAt,
        revision
      );
      this.sendWithEtag(res, revision, pricing[0]);
    } catch (err: any) {
      this.cleanupUploadedFile(req.file);
      this.sendError(res, err);
    }
  }

  async fork(req: any, res: any) {
    try {
      const { sourceOrganizationId, sourceSlug, sourceVersion, targetOrganizationId, name } = req.body;
      if (!sourceOrganizationId || !sourceSlug || !sourceVersion || !targetOrganizationId) {
        throw new Error(
          'INVALID DATA: sourceOrganizationId, sourceSlug, sourceVersion and targetOrganizationId are required'
        );
      }

      const result = await this.pricingService.forkPricing(
        sourceOrganizationId,
        sourceSlug,
        sourceVersion,
        targetOrganizationId,
        req.user,
        { name }
      );
      res.json(Array.isArray(result) ? result[0] : result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  /** Optional release timestamp (ISO 8601); it cannot be in the future. */
  private parseCreatedAt(value: unknown): Date | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('INVALID DATA: createdAt must be a valid ISO 8601 date');
    }
    if (parsed.getTime() > Date.now()) {
      throw new Error('INVALID DATA: createdAt must not be a future date');
    }
    return parsed;
  }

  private cleanupUploadedFile(file: any) {
    if (!file?.path) return;
    try {
      const directory = path.dirname(file.path);
      if (fs.existsSync(directory) && fs.readdirSync(directory).length === 1) fs.rmSync(directory, { recursive: true });
      else if (fs.existsSync(file.path)) fs.rmSync(file.path);
    } catch (cleanupError) {
      console.error('Unable to clean uploaded pricing file', cleanupError);
    }
  }

  async update(req: any, res: any) {
    try {
      const queryParams = req.query; 
      const revision = this.revisionContext(req, true);

      const pricing = await this.pricingService.update(
        req.params.pricingSlug,
        req.params.organizationId,
        req.user,
        req.body,
        queryParams,
        revision
      );
      this.sendWithEtag(res, revision, pricing);
    } catch (err: any) {
      this.sendError(res, err);
    }
  }

  async updateVersionVisibility(req: any, res: any) {
    try {
      const revision = this.revisionContext(req, true);
      const pricing = await this.pricingService.updateVersionVisibility(
        req.params.pricingSlug,
        req.params.pricingVersion,
        req.params.organizationId,
        req.user,
        req.body.private === true || req.body.private === 'true',
        revision
      );
      this.sendWithEtag(res, revision, pricing);
    } catch (err: any) {
      this.sendError(res, err);
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
      const revision = this.revisionContext(req, true);
      const result = await this.pricingService.destroy(
        req.params.pricingSlug,
        req.params.organizationId,
        req.user,
        queryParams,
        revision
      );
      if (!result) {
        res.status(404).send({ error: 'NOT FOUND: Pricing not found' });
      } else {
        res.status(200).send({ message: 'Pricing deleted successfully' });
      }
    } catch (err: any) {
      this.sendError(res, err);
    }
  }

  async destroyVersionByNameAndOrganization(req: any, res: any) {
    try {
      const revision = this.revisionContext(req, true);
      const result = await this.pricingService.destroyVersion(
        req.params.pricingSlug,
        req.params.pricingVersion,
        req.params.organizationId,
        req.user,
        revision
      );
      if (!result) {
        res.status(404).send({ error: 'NOT FOUND: Pricing version not found' });
      } else {
        this.sendWithEtag(res, revision, { message: 'Pricing version deleted successfully' });
      }
    } catch (err: any) {
      this.sendError(res, err);
    }
  }

  /**
   * The request's If-Match, for the service to check atomically with the write.
   * Without one the write goes ahead as before, unless PRICING_REQUIRE_IF_MATCH
   * is on and the write changes or deletes an existing pricing (428).
   */
  private revisionContext(req: any, changesExisting = false): PricingRevisionContext {
    const precondition = parseIfMatch(req.headers['if-match']);
    if (!precondition && changesExisting && isIfMatchRequired()) {
      throw new Error(
        'PRECONDITION REQUIRED: Send the ETag of the pricing you read in an If-Match header.'
      );
    }
    return { precondition };
  }

  private sendWithEtag(res: any, revision: PricingRevisionContext, body: unknown) {
    if (revision.etag) res.set('ETag', revision.etag);
    res.json(body);
  }

  private sendError(res: any, err: unknown) {
    if (err instanceof PreconditionFailedError && err.currentEtag) {
      res.set('ETag', err.currentEtag);
    }
    const { status, message } = handleError(err);
    res.status(status).send({ error: message });
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
