import container from '../config/container';
import PricingCollectionRepository from '../repositories/mongoose/PricingCollectionRepository';
import PricingRepository from '../repositories/mongoose/PricingRepository';
import { RetrievedCollection } from '../types/database/PricingCollection';
import { CollectionIndexQueryParams } from '../types/services/PricingCollection';
import { decompressZip } from '../utils/zip-manager';
import { PricingService as PricingAnalytics, retrievePricingFromPath } from 'pricing4ts/server';
import fs from 'fs';
import { calculateAnalyticsForPricings } from '../utils/pricing-collections-utils';
import { LeanUser } from '../types/models/User';
import { PermissionEngine } from '../policies/PermissionEngine';
import { generateSlug } from '../repositories/mongoose/models/PricingCollectionMongoose';
import { OrgRole } from '../types/models/Organization';
import UserService from './UserService';
import PermissionService from './PermissionService';
import OrganizationService from './OrganizationService';
import { Organization } from '../types/database/Organization';

class PricingCollectionService {
  private readonly pricingCollectionRepository: PricingCollectionRepository;
  private readonly pricingRepository: PricingRepository;
  private readonly permissionEngine: PermissionEngine;
  private readonly permissionService: PermissionService;
  private readonly userService: UserService;
  private readonly organizationService: OrganizationService;

  constructor() {
    this.pricingCollectionRepository = container.resolve('pricingCollectionRepository');
    this.pricingRepository = container.resolve('pricingRepository');
    this.permissionEngine = new PermissionEngine();
    this.permissionService = container.resolve('permissionService');
    this.userService = container.resolve('userService');
    this.organizationService = container.resolve('organizationService');
  }

  async index(queryParams: CollectionIndexQueryParams, reqUser?: LeanUser) {
    const isAdmin = reqUser && reqUser.role === 'ADMIN';

    const pricings = await this.pricingCollectionRepository.findAll(queryParams, {
      orgRole: null,
      pricings: [],
      collections: [],
      isGlobalAdmin: isAdmin ?? false,
      adminOrgIds: [],
    });
    return pricings;
  }

  async indexByOrganizationId(
    organizationId: string,
    reqUser?: LeanUser,
    queryParams?: CollectionIndexQueryParams
  ) {
    const orgRole: OrgRole | null = await this.permissionService.resolveOrgRole(
      reqUser?.id ?? '',
      organizationId
    );

    if (!reqUser || (reqUser.role !== 'ADMIN' && !orgRole)) {
      const collections = await this.pricingCollectionRepository.findByOrganizationId(
        organizationId,
        undefined,
        queryParams ?? { limit: 10, offset: 0 }
      );
      return collections;
    }

    const permissions = await this.permissionService.buildOrgUserPermissionsContext(
      reqUser,
      orgRole,
      organizationId
    );

    const collections = await this.pricingCollectionRepository.findByOrganizationId(
      organizationId,
      {
        ...permissions,
      },
      queryParams ?? { limit: 10, offset: 0 }
    );

    return collections;
  }

  async indexByUser(username: string, reqUser: LeanUser, queryParams?: CollectionIndexQueryParams) {
    if (username !== reqUser.username && reqUser.role !== 'ADMIN') {
      throw new Error(
        'PERMISSION ERROR: You can only query your own pricings. You can either provide your username or use "me" as username to query your pricings.'
      );
    }

    const user = await this.userService.show(username);

    if (!user) {
      throw new Error('NOT FOUND: User not found');
    }

    const userOrganizations = await this.organizationService.indexByUser(user.id, {
      treeFormat: false,
      pagination: { limit: Number.MAX_SAFE_INTEGER, offset: 0 },
    });
    const userOrganizationsIds = userOrganizations.items.map((org: Organization) => org.id);
    const permissions = await this.permissionService.buildUserPermissionsContext(user);
    const enhancedQueryParams = {
      ...queryParams,
      limit: queryParams?.limit ?? 10,
      offset: queryParams?.offset ?? 0,
      ...(permissions.isGlobalAdmin
        ? queryParams?.organizationIds
          ? { organizationIds: queryParams.organizationIds }
          : {}
        : {
            organizationIds: queryParams?.organizationIds
              ? queryParams.organizationIds.filter((id: string) => userOrganizationsIds.includes(id))
              : userOrganizationsIds,
          }),
    };
    const collections = await this.pricingCollectionRepository.findAll(
      enhancedQueryParams,
      permissions
    );
    return collections;
  }

  async show(organizationId: string, collectionSlug: string, reqUser?: LeanUser) {
    const collection = await this.pricingCollectionRepository.findByOrganizationAndSlug(
      organizationId,
      collectionSlug
    );
    if (!collection) {
      throw new Error('NOT FOUND: Pricing collection not found');
    }

    if (collection.private) {
      if (!reqUser) {
        throw new Error('PERMISSION ERROR: You are not a member of this organization');
      }
      const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
      const batchCtx = await this.permissionService.buildBatchContext(
        reqUser.id,
        organizationId,
        orgRole,
        reqUser.role === 'ADMIN'
      );
      const entityPerms = batchCtx.entityPermissions.get(`collection:${collection.slug}`);
      const evalResult = this.permissionEngine.evaluate({
        userId: reqUser.id,
        organizationId,
        entityType: 'collection',
        entitySlug: collection.slug,
        action: 'GET',
        isPrivate: true,
        userOrgRole: orgRole,
        isGlobalAdmin: reqUser.role === 'ADMIN',
        entityPermissions: entityPerms,
      });
      if (!evalResult.allowed) {
        throw new Error(`PERMISSION ERROR: ${evalResult.reason}`);
      }
    }

    collection.analytics = this._normalizeCollectionAnalytics(collection.analytics);

    return collection;
  }

  async create(newCollection: any, organizationId: string, reqUser: LeanUser) {
    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
    const batchCtx = await this.permissionService.buildBatchContext(
      reqUser.id,
      organizationId,
      orgRole,
      reqUser.role === 'ADMIN'
    );
    const createResult = this.permissionEngine.evaluate({
      userId: reqUser.id,
      organizationId,
      entityType: 'collection',
      action: 'CREATE',
      userOrgRole: orgRole,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      orgPermissions: batchCtx.orgPermissions.get('collection'),
    });
    if (!createResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${createResult.reason}`);
    }

    let collection: any;
    try {
      newCollection._organizationId = organizationId;
      if (!newCollection.slug && newCollection.name) {
        newCollection.slug = generateSlug(newCollection.name);
      }
      newCollection.analytics = {
        evolutionOfPlans: {
          dates: [],
          values: [],
        },
        evolutionOfAddOns: {
          dates: [],
          values: [],
        },
        evolutionOfFeatures: {
          dates: [],
          values: [],
        },
        evolutionOfConfigurationSpaceSize: {
          dates: [],
          values: [],
        },
      };

      collection = await this.pricingCollectionRepository.create(newCollection);

      if (orgRole === 'MEMBER') {
        try {
          await this.permissionService.grantEntityPermission(
            reqUser.id,
            organizationId,
            'collection',
            newCollection.slug,
            { GET: true, PUT: true, DELETE: true, CREATE: true }
          );
        } catch {
          // Permission grant failure should not block collection creation
        }
      }

      if (newCollection.pricings && newCollection.pricings.length > 0) {
        await this.pricingRepository.addPricingsToCollection(
          collection.id,
          organizationId,
          newCollection.pricings
        );

        await this.updateCollectionAnalytics(collection.id);
      }

      collection = await this.pricingCollectionRepository.findByOrganizationAndSlug(
        organizationId,
        newCollection.slug
      );

      return collection;
    } catch (err) {
      await this._handleCollectionCreationError(
        err as Error,
        collection,
        newCollection,
        organizationId
      );
    }
  }

  async bulkCreate(file: any, newCollectionData: any, organizationId: string, reqUser: LeanUser) {
    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
    const batchCtx = await this.permissionService.buildBatchContext(
      reqUser.id,
      organizationId,
      orgRole,
      reqUser.role === 'ADMIN'
    );
    const createResult = this.permissionEngine.evaluate({
      userId: reqUser.id,
      organizationId,
      entityType: 'collection',
      action: 'CREATE',
      userOrgRole: orgRole,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      orgPermissions: batchCtx.orgPermissions.get('collection'),
    });
    if (!createResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${createResult.reason}`);
    }

    let collection: any;
    try {
      const extractPath = this._getExtractPath(organizationId, newCollectionData.name);
      const zipPath = file.path;

      const extractedFiles = await decompressZip(zipPath, extractPath);

      newCollectionData._organizationId = organizationId;
      if (!newCollectionData.slug && newCollectionData.name) {
        newCollectionData.slug = generateSlug(newCollectionData.name);
      }

      // Create collection and keep reference so we only attempt cleanup if it was created
      collection = await this.pricingCollectionRepository.create(newCollectionData);

      const pricingDatas = [];
      const pricingsWithErrors = [];
      for (const pricing of extractedFiles) {
        if (!(pricing.endsWith('.yaml') || pricing.endsWith('.yml'))) {
          continue;
        }
        try {
          const uploadedPricing = retrievePricingFromPath(pricing);
          const pricingAnalytics = new PricingAnalytics(uploadedPricing);

          const normalizedPath = pricing.replace(/\\/g, '/');
          const staticIndex = normalizedPath.indexOf('static/');

          if (staticIndex === -1) {
            throw new Error('INVALID DATA: Invalid pricing path - it must contain "static/".');
          }

          const yamlPath = normalizedPath.slice(staticIndex);

          const pricingData = {
            name:
              uploadedPricing.saasName.split(' ')[0].charAt(0).toUpperCase() +
              uploadedPricing.saasName.split(' ')[0].slice(1).toLowerCase(),
            version: uploadedPricing.version,
            _collectionId: collection._id,
            _organizationId: organizationId,
            currency: uploadedPricing.currency,
            createdAt: new Date(uploadedPricing.createdAt),
            url: '',
            yaml: yamlPath,
            analytics: await pricingAnalytics.getAnalytics(),
          };
          pricingDatas.push(pricingData);
        } catch (err) {
          pricingsWithErrors.push({
            name: `${pricing.split('/')[pricing.split('/').length - 2]}/${pricing.split('/')[pricing.split('/').length - 1]}`,
            error: err,
          });
        }
      }

      await this.pricingRepository.create(pricingDatas);

      await this.updateCollectionAnalytics(collection.id);

      return [collection, pricingsWithErrors];
    } catch (err) {
      throw await this._handleCollectionCreationError(
        err as Error,
        collection,
        newCollectionData,
        organizationId
      );
    }
  }

  async generateCollectionAnalytics(collectionName: string, organizationId: string) {
    try {
      const collectionPricings =
        await this.pricingCollectionRepository.findCollectionPricingsByOrganization(
          collectionName,
          organizationId
        );
      if (!collectionPricings) {
        throw new Error('NOT FOUND: Collection not found');
      }

      const analytics = calculateAnalyticsForPricings(collectionPricings.pricings);

      await this.pricingCollectionRepository.setCollectionAnalytics(
        collectionPricings._id,
        analytics
      );
      return true;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }

  async update(organizationId: string, collectionSlug: string, data: any, reqUser: LeanUser) {
    const collection = await this.pricingCollectionRepository.findByOrganizationAndSlug(
      organizationId,
      collectionSlug
    );
    if (!collection) {
      throw new Error(
        'NOT FOUND: Either the collection does not exist or you are not a member of its organization'
      );
    }

    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
    const batchCtx = await this.permissionService.buildBatchContext(
      reqUser.id,
      organizationId,
      orgRole,
      reqUser.role === 'ADMIN'
    );

    const entityPerms = batchCtx.entityPermissions.get(`collection:${collection.slug}`);

    const updateResult = this.permissionEngine.evaluate({
      userId: reqUser.id,
      organizationId,
      entityType: 'collection',
      entitySlug: collection.slug,
      action: 'PUT',
      isPrivate: collection.private,
      userOrgRole: orgRole,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      entityPermissions: entityPerms,
    });
    if (!updateResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${updateResult.reason}`);
    }

    await this.pricingCollectionRepository.update(collection.id, data);

    const updatedCollection = await this.pricingCollectionRepository.findById(collection.id);

    if (!updatedCollection) {
      throw new Error('NOT FOUND: Collection not found after update');
    }

    if (updatedCollection.slug !== collection.slug) {
      try {
        const sourcePath = this._getExtractPath(organizationId, collection.slug);

        if (fs.existsSync(sourcePath)) {
          const destPath = this._getExtractPath(organizationId, updatedCollection.slug);

          fs.mkdirSync(destPath, { recursive: true });
          fs.renameSync(sourcePath, destPath);
        }
      } catch (err) {
        // Attempt to rollback collection slug change if folder rename fails
        await this.pricingCollectionRepository.update(collection.id, { slug: collection.slug });
        throw new Error(
          'Error renaming collection folder. Collection slug change has been rolled back. Please try again.'
        );
      }
    }

    return updatedCollection;
  }

  async updateCollectionAnalytics(collectionId: string) {
    const collection = await this.pricingCollectionRepository.findById(collectionId);

    if (!collection) {
      throw new Error('NOT FOUND: Pricing collection not found');
    }

    // findById doesn't $lookup pricings, so we need to fetch them separately
    const collectionWithPricings =
      await this.pricingCollectionRepository.findCollectionPricingsByOrganization(
        collection.slug,
        collection.organization.id
      );

    const analyticsData = collectionWithPricings ?? collection;
    const newAnalyticsEntry = this._computeCollectionAnalytics(analyticsData);

    await this.pricingCollectionRepository.updateAnalytics(collection.id, newAnalyticsEntry);
  }

  async destroy(
    organizationId: string,
    collectionSlug: string,
    deleteCascade: boolean,
    ignoreResult: boolean = false,
    reqUser?: LeanUser
  ) {
    if (!reqUser && !ignoreResult) {
      throw new Error(
        'INTERNAL ERROR: You have not provided "reqUser". Either set "ignoreResult" to true or provide the user performing the action as "reqUser".'
      );
    }

    const collection = await this.pricingCollectionRepository.findByOrganizationAndSlug(
      organizationId,
      collectionSlug
    );
    if (!collection) {
      throw new Error(
        'NOT FOUND: Either the collection does not exist or you are not a member of its organization'
      );
    }

    if (reqUser && !ignoreResult) {
      const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
      const batchCtx = await this.permissionService.buildBatchContext(
        reqUser.id,
        organizationId,
        orgRole,
        reqUser.role === 'ADMIN'
      );

      const entityPerms = batchCtx.entityPermissions.get(`collection:${collection.slug}`);

      const deleteResult = this.permissionEngine.evaluate({
        userId: reqUser.id,
        organizationId,
        entityType: 'collection',
        entitySlug: collection.slug,
        action: 'DELETE',
        isPrivate: collection.private,
        userOrgRole: orgRole,
        isGlobalAdmin: reqUser.role === 'ADMIN',
        entityPermissions: entityPerms,
      });
      if (!deleteResult.allowed) {
        throw new Error(`PERMISSION ERROR: ${deleteResult.reason}`);
      }
    }

    let result;

    if (deleteCascade) {
      result = await this.pricingCollectionRepository.destroyWithPricings(collection.id);

      const collectionPath = this._getExtractPath(organizationId, collection.slug);
      if (fs.existsSync(collectionPath)) {
        fs.rmSync(collectionPath, { recursive: true });
      }
    } else {
      await this.pricingRepository.removePricingsFromCollection(collection.id);
      result = await this.pricingCollectionRepository.destroy(collection.id);
    }

    if (!result && !ignoreResult) {
      throw new Error('NOT FOUND: Collection not found');
    }

    return true;
  }

  async removePricingFromCollection(
    pricingSlug: string,
    organizationId: string,
    collectionSlug: string,
    reqUser?: LeanUser
  ) {
    try {
      if (reqUser) {
        const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
        const evalResult = this.permissionEngine.evaluate({
          userId: reqUser.id,
          organizationId,
          entityType: 'pricing',
          action: 'PUT',
          userOrgRole: orgRole,
          isGlobalAdmin: reqUser.role === 'ADMIN',
        });
        if (!evalResult.allowed) {
          throw new Error(`PERMISSION ERROR: ${evalResult.reason}`);
        }
      }

      const pricing = await this.pricingRepository.findOne(pricingSlug, organizationId, {
        collection: collectionSlug,
      });

      if (!pricing) {
        throw new Error(
          'NOT FOUND: Either the pricing does not exist or you are not a member of its organization'
        );
      }

      await this.pricingRepository.removePricingFromCollection(pricingSlug, organizationId);
      if (pricing.versions[0]._collectionId) {
        await this.updateCollectionAnalytics(pricing.versions[0]._collectionId);
      } else {
        throw new Error('NOT FOUND: Pricing is not in a collection');
      }

      return true;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }

  _computeCollectionAnalytics(collection: RetrievedCollection) {
    const collectionPricings = collection.pricings?.[0]?.pricings ?? [];
    const numberOfPricings = collectionPricings.length;
    if (collectionPricings.length === 0) {
      return {
        evolutionOfPlans: { date: new Date().toISOString(), value: 0 },
        evolutionOfAddOns: { date: new Date().toISOString(), value: 0 },
        evolutionOfConfigurationSpaceSize: { date: new Date().toISOString(), value: 0 },
        evolutionOfFeatures: { date: new Date().toISOString(), value: 0 },
      };
    }

    // Compute the new average analytics
    const aggregated = collectionPricings.reduce(
      (acc: any, pricing: any) => {
        acc.numberOfPlans += pricing.analytics.numberOfPlans / numberOfPricings;
        acc.numberOfAddOns += pricing.analytics.numberOfAddOns / numberOfPricings;
        acc.configurationSpaceSize += pricing.analytics.configurationSpaceSize / numberOfPricings;
        acc.numberOfFeatures += pricing.analytics.numberOfFeatures / numberOfPricings;
        return acc;
      },
      {
        numberOfPlans: 0,
        numberOfAddOns: 0,
        configurationSpaceSize: 0,
        numberOfFeatures: 0,
      }
    );

    const currentDate = new Date().toISOString(); // Sets the current date to dates

    const evolution: any = {
      evolutionOfPlans: { date: currentDate, value: aggregated.numberOfPlans },
      evolutionOfAddOns: { date: currentDate, value: aggregated.numberOfAddOns },
      evolutionOfConfigurationSpaceSize: {
        date: currentDate,
        value: aggregated.configurationSpaceSize,
      },
      evolutionOfFeatures: { date: currentDate, value: aggregated.numberOfFeatures },
    };

    return evolution;
  }

  _getExtractPath(organizationId: string, collectionSlug: string) {
    return `${process.env.SERVER_STATICS_FOLDER || "public/"}${process.env.COLLECTIONS_FOLDER || "static/collections"}/${organizationId}/${collectionSlug}`;
  }

  async _handleCollectionCreationError(
    err: Error,
    collection: any,
    newCollectionData: any,
    organizationId: string
  ): Promise<Error> {
    // If a collection was created before the error, remove it (cleanup of partial state)
    try {
      if (collection?._id) {
        await this.destroy(
          organizationId,
          newCollectionData.slug || generateSlug(newCollectionData.name),
          true,
          true
        );
      }
    } catch (cleanupErr) {
      // If cleanup fails, log it but continue to throw the original error

      console.error('Error during cleanup after bulkCreate failure:', cleanupErr);
    }

    const errMsg = (err as any)?.message || String(err);

    // Detect duplicate key / already exists errors and surface a clear message
    if (
      errMsg.includes('E11000') ||
      errMsg.toLowerCase().includes('duplicate') ||
      errMsg.toLowerCase().includes('already exists')
    ) {
      throw new Error('A collection with this name already exists. Please choose another name.');
    }

    throw new Error(errMsg);
  }

  _normalizeCollectionAnalytics(analytics: any) {
    const ensureSeries = (series: any) => ({
      dates: Array.isArray(series?.dates) ? series.dates : [],
      values: Array.isArray(series?.values) ? series.values : [],
    });

    return {
      evolutionOfPlans: ensureSeries(analytics?.evolutionOfPlans),
      evolutionOfAddOns: ensureSeries(analytics?.evolutionOfAddOns),
      evolutionOfFeatures: ensureSeries(analytics?.evolutionOfFeatures),
      evolutionOfConfigurationSpaceSize: ensureSeries(analytics?.evolutionOfConfigurationSpaceSize),
    };
  }
}

export default PricingCollectionService;
