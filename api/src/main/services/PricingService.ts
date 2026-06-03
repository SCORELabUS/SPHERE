import { Pricing } from 'pricing4ts';
import { Pricing as PricingModel } from '../types/database/Pricing';
import container from '../config/container';
import { processFileUris } from './FileService';
import {
  PricingService as PricingAnalytics,
  retrievePricingFromPath,
  retrievePricingFromText,
} from 'pricing4ts/server';
import { PricingIndexQueryParams } from '../types/services/PricingService';
import PricingCollectionService from './PricingCollectionService';
import PricingRepository from '../repositories/mongoose/PricingRepository';
import CacheService from './CacheService';
import { LeanUser } from '../types/models/User';
import { PermissionEngine } from '../policies/PermissionEngine';
import { generateSlug, generateTextFromSlug, deduplicateSlug } from '../utils/slug-manager';
import { OrgRole } from '../types/models/Organization';
import OrganizationService from './OrganizationService';
import { Organization } from '../types/database/Organization';
import UserService from './UserService';
import PermissionService from './PermissionService';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

class PricingService {
  private pricingRepository: PricingRepository;
  private pricingCollectionService: PricingCollectionService;
  private cacheService: CacheService;
  private permissionEngine: PermissionEngine;
  private permissionService: PermissionService;
  private organizationService: OrganizationService;
  private userService: UserService;

  constructor() {
    this.pricingRepository = container.resolve('pricingRepository');
    this.pricingCollectionService = container.resolve('pricingCollectionService');
    this.cacheService = container.resolve('cacheService');
    this.permissionEngine = new PermissionEngine();
    this.permissionService = container.resolve('permissionService');
    this.organizationService = container.resolve('organizationService');
    this.userService = container.resolve('userService');
  }

  async index(queryParams: PricingIndexQueryParams, reqUser?: LeanUser) {
    const isAdmin = reqUser && reqUser.role === 'ADMIN';

    const pricings = await this.pricingRepository.findAll(queryParams, {
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
    queryParams?: PricingIndexQueryParams
  ) {
    const orgRole: OrgRole | null = await this.permissionService.resolveOrgRole(
      reqUser?.id ?? '',
      organizationId
    );

    if (!reqUser || (reqUser.role !== 'ADMIN' && !orgRole)) {
      const pricings = await this.pricingRepository.findByOrganizationId(
        organizationId,
        { orgRole: null, pricings: [], collections: [], isGlobalAdmin: false, adminOrgIds: [] },
        queryParams ?? { limit: 10, offset: 0 }
      );
      return pricings;
    }

    const permissions = await this.permissionService.buildOrgUserPermissionsContext(
      reqUser,
      orgRole,
      organizationId
    );

    const pricings = await this.pricingRepository.findByOrganizationId(
      organizationId,
      permissions,
      queryParams ?? { limit: 10, offset: 0 }
    );

    return pricings;
  }

  async indexByUser(username: string, reqUser: LeanUser, queryParams?: PricingIndexQueryParams) {
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
      ...(permissions.isGlobalAdmin ? {} : { selectedOrganizations: userOrganizationsIds }),
    };
    const pricings = await this.pricingRepository.findAll(enhancedQueryParams, permissions);
    return pricings;
  }

  async indexByCollection(collectionId: string) {
    const pricings = await this.pricingRepository.findByCollection(collectionId);
    return pricings;
  }

  async show(
    slug: string,
    organizationId: string,
    reqUser?: LeanUser,
    queryParams: { collectionSlug?: string; includePrivate: boolean } = { includePrivate: false }
  ) {
    if (reqUser) {
      const role = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
      queryParams.includePrivate = reqUser.role === 'ADMIN' || role !== null;
    }

    const pricing: { name: string; slug: string; versions: PricingModel[] } | null =
      await this.pricingRepository.findOne(slug, organizationId, queryParams);

    if (!pricing) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    for (const version of pricing.versions) {
      processFileUris(version, ['yaml']);
    }

    return pricing;
  }

  async getConfigurationSpace(
    organizationId: string,
    pricingSlug: string,
    pricingVersion: string,
    reqUser?: LeanUser,
    queryParams?: { collectionSlug?: string; limit?: string; offset?: string }
  ) {
    // Validations
    if (queryParams?.limit && !/^\d+$/.test(queryParams.limit)) {
      throw new Error('INVALID DATA: Invalid limit parameter, it must be a numeric value');
    }

    if (queryParams?.offset && !/^\d+$/.test(queryParams.offset)) {
      throw new Error('INVALID DATA: Invalid offset parameter, it must be a numeric value');
    }

    const formattedQueryParams = {
      limit: queryParams?.limit ? parseInt(queryParams.limit) : undefined,
      offset: queryParams?.offset ? parseInt(queryParams.offset) : undefined,
    };

    let includePrivate = false;
    if (reqUser) {
      const role = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
      includePrivate = reqUser.role === 'ADMIN' || role !== null;
    }

    const retrievedPricing = await this.pricingRepository.findOne(
      pricingSlug,
      organizationId,
      {
        ...queryParams,
        version: pricingVersion,
        includePrivate,
      }
    );
    if (!retrievedPricing) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    if (!process.env.SERVER_STATICS_FOLDER) {
      throw new Error('SERVER_STATICS_FOLDER env not set');
    }

    let configurationSpace = null;
    const key: string = `${organizationId}.${pricingSlug}.${pricingVersion}.configurationSpace`;
    const cachedConfigurationSpace = await this.cacheService.get(key);

    if (cachedConfigurationSpace) {
      configurationSpace = cachedConfigurationSpace;
    } else {
      // Configuariton space calculation
      const pricingInfo: Pricing = retrievePricingFromPath(
        process.env.SERVER_STATICS_FOLDER + retrievedPricing.versions[0].yaml
      );
      const pricingAnalytics = new PricingAnalytics(pricingInfo);
      configurationSpace = await pricingAnalytics.getConfigurationSpace();
      await this.cacheService.set(key, configurationSpace, 60 * 60 * 24);
    }

    // Pagination
    const startPaginationIndex = formattedQueryParams.offset ? formattedQueryParams.offset : 0;
    const endPaginationIndex = formattedQueryParams.limit
      ? startPaginationIndex + formattedQueryParams.limit
      : configurationSpace.length;

    return [
      configurationSpace.slice(startPaginationIndex, endPaginationIndex),
      configurationSpace.length,
    ];
  }

  async create(
    pricingFile: any,
    organizationId: string,
    isPrivate: boolean,
    reqUser: LeanUser,
    collectionId?: string,
    name?: string
  ) {
    return this._createPricingVersion(
      pricingFile,
      organizationId,
      isPrivate,
      reqUser,
      collectionId,
      undefined,
      name
    );
  }

  async createVersion(
    pricingFile: any,
    organizationId: string,
    pricingSlug: string,
    isPrivate: boolean,
    reqUser: LeanUser,
    collectionId?: string
  ) {
    return this._createPricingVersion(
      pricingFile,
      organizationId,
      isPrivate,
      reqUser,
      collectionId,
      pricingSlug
    );
  }

  private async _createPricingVersion(
    pricingFile: any,
    organizationId: string,
    isPrivate: boolean,
    reqUser: LeanUser,
    collectionId?: string,
    overrideSlug?: string,
    name?: string
  ) {
    if (!pricingFile) {
      throw new Error('INVALID DATA: Pricing file is required');
    }

    try {
      const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
      const batchCtx = await this.permissionService.buildBatchContext(
        reqUser.id,
        organizationId,
        orgRole,
        reqUser.role === 'ADMIN'
      );

      const filePath = typeof pricingFile === 'string' ? pricingFile : pricingFile.path;

      const lookupSlug = overrideSlug
        ? generateSlug(overrideSlug)
        : name
          ? generateSlug(name)
          : generateSlug(retrievePricingFromPath(filePath).saasName);

      const previousPricing = await this.pricingRepository.findOne(
        lookupSlug,
        organizationId,
        {
          collectionId: collectionId,
          includePrivate: true,
        }
      );

      const isAddingVersion =
        !!previousPricing && previousPricing.versions && previousPricing.versions.length > 0;

      if (isAddingVersion) {
        // Adding a version to existing pricing: only entity-level CREATE required
        const pricingSlug = previousPricing.slug!;
        const entityPerms = batchCtx.entityPermissions.get(`pricing:${pricingSlug}`);
        const entityCreateResult = this.permissionEngine.evaluate({
          userId: reqUser.id,
          organizationId,
          entityType: 'pricing',
          entitySlug: pricingSlug,
          action: 'CREATE',
          isPrivate: previousPricing.private === true,
          userOrgRole: orgRole,
          isGlobalAdmin: reqUser.role === 'ADMIN',
          entityPermissions: entityPerms,
        });
        if (!entityCreateResult.allowed) {
          throw new Error(`PERMISSION ERROR: ${entityCreateResult.reason}`);
        }
      } else {
        // Creating a new pricing: org-level CREATE required
        const createResult = this.permissionEngine.evaluate({
          userId: reqUser.id,
          organizationId,
          entityType: 'pricing',
          action: 'CREATE',
          userOrgRole: orgRole,
          isGlobalAdmin: reqUser.role === 'ADMIN',
          orgPermissions: batchCtx.orgPermissions.get('pricing'),
        });
        if (!createResult.allowed) {
          throw new Error(`PERMISSION ERROR: ${createResult.reason}`);
        }
      }

      if (!collectionId && previousPricing && previousPricing.versions[0]._collectionId) {
        collectionId = previousPricing.versions[0]._collectionId.toString();
      }

      const rawPath = typeof pricingFile === 'string' ? pricingFile : pricingFile.path;
      const normalizedPath = rawPath.replace(/\\/g, '/');
      const staticIndex = normalizedPath.indexOf('static/');

      if (staticIndex === -1) {
        throw new Error('Invalid pricing path: it must contain "static/".');
      }

      const yamlPath = normalizedPath.slice(staticIndex);

      let pricingName: string;
      if (isAddingVersion) {
        pricingName = previousPricing.name;
      } else if (name) {
        pricingName = name;
      } else {
        pricingName = retrievePricingFromPath(filePath).saasName;
      }

      const uploadedPricing: Pricing = retrievePricingFromPath(filePath);

      let pricingSlug: string;
      if (isAddingVersion) {
        pricingSlug = previousPricing.slug!;
      } else {
        const baseSlug = generateSlug(pricingName);
        pricingSlug = await deduplicateSlug(baseSlug, (slug) =>
          this.pricingRepository.findExistingSlug(slug, organizationId)
        );
      }

      const pricingData = {
        name: pricingName,
        slug: pricingSlug,
        version: uploadedPricing.version,
        _collectionId: collectionId,
        _organizationId: organizationId,
        private: isPrivate,
        currency: uploadedPricing.currency,
        createdAt: new Date(uploadedPricing.createdAt),
        url: '',
        yaml: yamlPath,
        analytics: {},
      };

      const pricing = await this.pricingRepository.create([pricingData]);

      if (pricingName !== uploadedPricing.saasName) {
        const staticFolder = process.env.SERVER_STATICS_FOLDER || 'public/';
        const finalYamlPath = path.resolve(staticFolder, yamlPath);
        const yamlContent = fs.readFileSync(filePath, 'utf8');
        const yamlData = yaml.load(yamlContent) as Record<string, any>;
        if (yamlData && typeof yamlData === 'object') {
          yamlData['saasName'] = pricingName;
          fs.mkdirSync(path.dirname(finalYamlPath), { recursive: true });
          fs.writeFileSync(finalYamlPath, yaml.dump(yamlData, { lineWidth: -1 }), 'utf8');
        }
      }

      processFileUris(pricing[0], ['yaml']);

      const pricingAnalytics = new PricingAnalytics(uploadedPricing);

      await pricingAnalytics
        .getAnalytics()
        .then((analytics: any) => {
          this.pricingRepository.updateAnalytics(pricing[0]._id.toString(), analytics);
        })
        .catch(async (err: any) => {
          await this.pricingRepository.destroy(pricing[0]._id.toString());
          throw new Error((err as Error).message);
        });

      if (collectionId) {
        await this.pricingCollectionService.updateCollectionAnalytics(collectionId);
      }

      return pricing;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }

  async addPricingToCollection(
    pricingName: string,
    organizationId: string,
    collectionId: string,
    queryParams: { collectionSlug?: string } = {}
  ) {
    try {
      const pricing = await this.pricingRepository.findOne(pricingName, organizationId, {
        ...queryParams,
        includePrivate: true,
      });
      if (!pricing) {
        throw new Error(
          "NOT FOUND: Pricing not found. Please check that: 1) the pricing is created, 2) that you're a member of the organization, and 3) that the collectionName you've specified is correct (the collectionName is case-sensitive)."
        );
      }

      await this.pricingRepository.addPricingToCollection(
        pricingName,
        organizationId,
        collectionId
      );
      await this.pricingCollectionService.updateCollectionAnalytics(collectionId);

      return true;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }

  async update(
    pricingSlug: string,
    organizationId: string,
    reqUser: LeanUser,
    data: any,
    queryParams: { collectionSlug?: string; organizationId?: string } = {}
  ) {
    const effectiveOrgId = queryParams.organizationId || organizationId;
    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, effectiveOrgId);

    const pricing = await this.pricingRepository.findOne(pricingSlug, effectiveOrgId, {
      ...queryParams,
      includePrivate: true,
    });
    if (!pricing) {
      throw new Error(
        'NOT FOUND: Either the pricing does not exist or you are not a member of its organization'
      );
    }

    const batchCtx = await this.permissionService.buildBatchContext(
      reqUser.id,
      effectiveOrgId,
      orgRole,
      reqUser.role === 'ADMIN'
    );

    const entityPerms = batchCtx.entityPermissions.get(`pricing:${pricingSlug}`);

    const updateResult = this.permissionEngine.evaluate({
      userId: reqUser.id,
      organizationId: effectiveOrgId,
      entityType: 'pricing',
      entitySlug: pricingSlug,
      action: 'PUT',
      isPrivate: pricing.private,
      userOrgRole: orgRole,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      entityPermissions: entityPerms,
    });
    if (!updateResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${updateResult.reason}`);
    }

    for (const pricingVersion of pricing.versions) {
      await this.pricingRepository.update(pricingVersion.id, data);
    }

    const updatedPricing = await this.pricingRepository.findOne(pricingSlug, effectiveOrgId, {
      ...queryParams,
      includePrivate: true,
    });

    return updatedPricing;
  }

  async updateVersion(pricingString: string) {
    try {
      const updatedPricing: Pricing = retrievePricingFromText(pricingString);
      return updatedPricing;
    } catch (err) {
      throw new Error('INVALID DATA: Error updating pricing: ' + (err as Error).message);
    }
  }

  async updatePricingsCollectionName(
    collectionSlug: string,
    newCollectionName: string,
    collectionId: string
  ) {
    if (collectionSlug === generateSlug(newCollectionName)) {
      return true;
    }

    const pricings = await this.pricingRepository.findByCollection(collectionId);
    const pricingsToUpdate = [];
    for (const pricing of pricings) {
      if (
        pricing.yaml
          .toLocaleLowerCase()
          .includes(generateTextFromSlug(collectionSlug).toLocaleLowerCase())
      ) {
        pricing.yaml = pricing.yaml.replace(
          new RegExp(generateTextFromSlug(collectionSlug), 'i'),
          newCollectionName
        );
        pricingsToUpdate.push(pricing);
      }
    }

    await this.pricingRepository.updatePricingsCollectionName(pricingsToUpdate);
    return true;
  }

  async destroy(
    pricingSlug: string,
    organizationId: string,
    reqUser: LeanUser,
    queryParams: { collectionSlug?: string; organizationId?: string } = {}
  ) {
    const effectiveOrgId = queryParams.organizationId || organizationId;
    let collectionId;

    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, effectiveOrgId);

    const pricing = await this.pricingRepository.findOne(pricingSlug, effectiveOrgId, {
      ...queryParams,
      includePrivate: true,
    });

    if (!pricing) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    const batchCtx = await this.permissionService.buildBatchContext(
      reqUser.id,
      effectiveOrgId,
      orgRole,
      reqUser.role === 'ADMIN'
    );

    const entityPerms = batchCtx.entityPermissions.get(`pricing:${pricingSlug}`);

    const deleteResult = this.permissionEngine.evaluate({
      userId: reqUser.id,
      organizationId: effectiveOrgId,
      entityType: 'pricing',
      entitySlug: pricingSlug,
      action: 'DELETE',
      isPrivate: pricing?.private,
      userOrgRole: orgRole,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      entityPermissions: entityPerms,
    });
    if (!deleteResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${deleteResult.reason}`);
    }

    if (queryParams?.collectionSlug) {
      const collection = await this.pricingCollectionService.show(
        effectiveOrgId,
        queryParams.collectionSlug,
        reqUser
      );
      if (!collection) {
        throw new Error('NOT FOUND: Collection not found');
      }

      collectionId = collection.id;
    }

    // TODO: debe eliminar por slug
    const result = await this.pricingRepository.destroyByNameOrganizationAndCollectionId(
      pricing!.name,
      effectiveOrgId,
      collectionId
    );
    if (!result) {
      throw new Error(
        'NOT FOUND: Either the pricing does not exist or you are not a member of its organization'
      );
    }
    return true;
  }

  async destroyVersion(
    pricingSlug: string,
    pricingVersion: string,
    organizationId: string,
    reqUser: LeanUser
  ) {
    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);

    const pricing = await this.pricingRepository.findOne(pricingSlug, organizationId, {
      includePrivate: true,
    });

    if (!pricing) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    const batchCtx = await this.permissionService.buildBatchContext(
      reqUser.id,
      organizationId,
      orgRole,
      reqUser.role === 'ADMIN'
    );

    const entityPerms = batchCtx.entityPermissions.get(`pricing:${pricingSlug}`);

    const deleteResult = this.permissionEngine.evaluate({
      userId: reqUser.id,
      organizationId,
      entityType: 'pricing',
      entitySlug: pricingSlug,
      action: 'DELETE',
      isPrivate: pricing?.private,
      userOrgRole: orgRole,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      entityPermissions: entityPerms,
    });
    if (!deleteResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${deleteResult.reason}`);
    }

    let result;

    // TODO: debe eliminar por slug y version
    result = await this.pricingRepository.destroyVersionByNameAndOrganization(
      pricing!.name,
      pricingVersion,
      organizationId
    );

    if (!result) {
      // TODO: debe eliminar por slug y version
      result = await this.pricingRepository.destroyVersionByNameAndOrganization(
        pricing!.name,
        pricingVersion.replace('_', '.'),
        organizationId
      );
    }

    if (!result) {
      throw new Error(
        'NOT FOUND: Either the pricing does not exist or you are not a member of its organization'
      );
    }

    return true;
  }
}

export default PricingService;
