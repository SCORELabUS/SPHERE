import { Pricing } from 'pricing4ts';
import { Pricing as PricingModel } from '../types/database/Pricing';
import { ForkedFrom } from '../types/models/Pricing';
import container from '../config/container';
import { processFileUris } from './FileService';
import { sanitizePathSegment } from '../utils/path-utils';
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

  /**
   * Forks one version of a pricing into another organization.
   *
   * The fork is added as a new version of an existing pricing in the target organization,
   * instead of creating a duplicate, when either:
   *  - the target org already has a pricing forked from this same origin (matched by
   *    `forkedFrom.pricingId`, not by name — the user may have renamed that earlier fork), or
   *  - the target org already has an (unrelated) pricing with the same name as the source
   *    (matched the same way the normal, non-fork publish flow already treats a name clash).
   * When either match is found without `options.confirm`, no write is performed: the caller
   * gets back `{ needsConfirmation: true, ... }` so the UI can ask before proceeding,
   * optionally renaming the destination pricing via `options.name`.
   */
  async forkPricing(
    sourceOrganizationId: string,
    sourceSlug: string,
    sourceVersion: string,
    targetOrganizationId: string,
    reqUser: LeanUser,
    options: { name?: string; confirm?: boolean } = {}
  ) {
    if (sourceOrganizationId === targetOrganizationId) {
      throw new Error('INVALID DATA: Cannot fork a pricing into its own organization');
    }

    // A pricing is forkable by whoever can already view it: same visibility rule as show().
    const sourceOrgRole = await this.permissionService.resolveOrgRole(reqUser.id, sourceOrganizationId);
    const includeSourcePrivate = reqUser.role === 'ADMIN' || sourceOrgRole !== null;

    const sourcePricing = await this.pricingRepository.findOne(sourceSlug, sourceOrganizationId, {
      version: sourceVersion,
      includePrivate: includeSourcePrivate,
    });

    if (!sourcePricing || !sourcePricing.versions?.length || !sourcePricing.pricingId) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    const sourceVersionDoc = sourcePricing.versions[0];

    const staticFolder = process.env.SERVER_STATICS_FOLDER || 'public/';
    const sourceAbsolutePath = path.resolve(staticFolder, sourceVersionDoc.yaml);
    if (!fs.existsSync(sourceAbsolutePath)) {
      throw new Error('NOT FOUND: Pricing file not found');
    }

    // Copy before ever parsing: pricing4ts's retrievePricingFromPath can rewrite the file
    // it's given (schema/version normalization) as a side effect, and the source YAML
    // belongs to another organization's pricing — it must never be mutated by a fork.
    const uploadBaseFolder = path.resolve(process.cwd(), 'public', 'static', 'pricings', 'uploaded');
    const draftDir = path.resolve(uploadBaseFolder, sanitizePathSegment(sourcePricing.name, 'unknown-saas'));
    fs.mkdirSync(draftDir, { recursive: true });
    const ext = path.extname(sourceAbsolutePath) || '.yml';
    const copiedAbsolutePath = path.resolve(
      draftDir,
      `${sanitizePathSegment(sourceVersionDoc.version, '0.0.0')}-fork-${Date.now()}${ext}`
    );
    fs.copyFileSync(sourceAbsolutePath, copiedAbsolutePath);

    let versionCreated = false;

    try {
      // The pricing's DB-level `version` (e.g. "2021") is only a label; what actually gets
      // stored per version is the YAML's own `version` field (e.g. "2021-11-29"), which is
      // what the fork's version-conflict check must compare against.
      const parsedSource = retrievePricingFromPath(copiedAbsolutePath);

      const existingForkStub = await this.pricingRepository.findForkOfOrigin(
        targetOrganizationId,
        sourcePricing.pricingId
      );
      let matchedPricing = existingForkStub?.slug
        ? await this.pricingRepository.findOne(existingForkStub.slug, targetOrganizationId, {
            includePrivate: true,
          })
        : null;

      if (!matchedPricing) {
        // No prior fork of this exact origin in the target org — but if it already has a
        // pricing with the source's name (created independently, or forked from somewhere
        // else), match it the same way the normal, non-fork publish flow treats a name
        // clash: add a version to it instead of silently deduplicating the slug into an
        // unrelated duplicate. Always keyed off the source's own name (not `options.name`)
        // so this lookup is stable across the confirm/no-confirm round trip.
        const candidateSlug = generateSlug(sourcePricing.name);
        const byNameMatch = await this.pricingRepository.findOne(candidateSlug, targetOrganizationId, {
          includePrivate: true,
        });
        if (byNameMatch?.versions?.length) {
          matchedPricing = byNameMatch;
        }
      }

      if (matchedPricing) {
        const versionAlreadyForked = matchedPricing.versions?.some(
          (v: PricingModel & { version: string }) => v.version === parsedSource.version
        );
        if (versionAlreadyForked) {
          throw new Error(
            `CONFLICT: ${matchedPricing.name} version ${parsedSource.version} already exists in this organization.`
          );
        }

        if (!options.confirm) {
          // Nothing gets written yet: the draft copy was only needed to read the real
          // version string above, so it's cleaned up before asking the caller to confirm.
          if (fs.existsSync(copiedAbsolutePath)) {
            fs.rmSync(copiedAbsolutePath);
          }
          return {
            needsConfirmation: true as const,
            existingPricing: { name: matchedPricing.name, slug: matchedPricing.slug },
            sourceVersion: sourceVersionDoc.version,
          };
        }
      }

      const sourceOrganization = (sourceVersionDoc as any).organization;
      const sourceCollection = (sourcePricing as any).collection;

      const forkedFrom: ForkedFrom = {
        pricingId: sourcePricing.pricingId,
        organizationId: sourceOrganizationId,
        organizationName: sourceOrganization?.name ?? '',
        organizationDisplayName: sourceOrganization?.displayName ?? sourceOrganization?.name ?? '',
        ...(sourceCollection?.id ? { collectionId: sourceCollection.id, collectionName: sourceCollection.name, collectionSlug: sourceCollection.slug } : {}),
        slug: sourcePricing.slug!,
        name: sourcePricing.name,
        // The version's DB-level label (e.g. "2021"), as shown in the source pricing's
        // version picker — not the YAML-internal version string, which is meaningless here.
        version: sourceVersionDoc.version,
      };

      const forkedPricingName = options.name || matchedPricing?.name || sourcePricing.name;
      const pricing = await this._createPricingVersion(
        { path: copiedAbsolutePath },
        targetOrganizationId,
        sourceVersionDoc.private === true,
        reqUser,
        undefined,
        undefined,
        forkedPricingName,
        forkedFrom,
        matchedPricing ?? null,
        new Date()
      );
      // From here on the stored version references the copied file, so a later failure
      // (e.g. the rename below) must not delete it.
      versionCreated = true;

      if (matchedPricing && options.name && options.name !== matchedPricing.name) {
        // The renamed slug differs from the one _createPricingVersion just returned:
        // reflect it in the response so callers (e.g. the frontend redirect) land on
        // the pricing's real, current URL instead of the pre-rename one.
        const renamed = await this.update(matchedPricing.slug!, targetOrganizationId, reqUser, { name: options.name });
        if (renamed?.slug) {
          pricing[0].slug = renamed.slug;
          pricing[0].name = renamed.name;
        }
      }

      return pricing;
    } catch (err) {
      if (!versionCreated && fs.existsSync(copiedAbsolutePath)) {
        fs.rmSync(copiedAbsolutePath);
      }
      throw err;
    }
  }

  private async _createPricingVersion(
    pricingFile: any,
    organizationId: string,
    isPrivate: boolean,
    reqUser: LeanUser,
    collectionId?: string,
    overrideSlug?: string,
    name?: string,
    forkedFrom?: ForkedFrom,
    previousPricingOverride?: any,
    createdAtOverride?: Date
  ) {
    if (!pricingFile) {
      throw new Error('INVALID DATA: Pricing file is required');
    }

    let uploadedPricing: Pricing | undefined;

    try {
      const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
      const batchCtx = await this.permissionService.buildBatchContext(
        reqUser.id,
        organizationId,
        orgRole,
        reqUser.role === 'ADMIN'
      );

      const filePath = typeof pricingFile === 'string' ? pricingFile : pricingFile.path;
      uploadedPricing = retrievePricingFromPath(filePath);

      // A fork already knows which pricing (if any) it should attach a new version to,
      // resolved by origin rather than by name/slug: skip the usual name-based lookup.
      let previousPricing = previousPricingOverride;
      if (previousPricingOverride === undefined) {
        const lookupSlug = overrideSlug
          ? generateSlug(overrideSlug)
          : name
            ? generateSlug(name)
            : generateSlug(uploadedPricing.saasName);

        previousPricing = await this.pricingRepository.findOne(
          lookupSlug,
          organizationId,
          {
            collectionId: collectionId,
            includePrivate: true,
          }
        );
      }

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

      const versionAlreadyExists = previousPricing?.versions?.some(
        (pricingVersion: PricingModel & { version: string }) =>
          pricingVersion.version === uploadedPricing!.version
      );
      if (versionAlreadyExists) {
        throw new Error(
          `CONFLICT: ${previousPricing.name} version ${uploadedPricing.version} already exists. Change the version in the YAML before publishing.`
        );
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
        pricingName = uploadedPricing.saasName;
      }

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
        ...(isAddingVersion && previousPricing.pricingId ? { pricingId: previousPricing.pricingId } : {}),
        ...(forkedFrom ? { forkedFrom } : {}),
        name: pricingName,
        slug: pricingSlug,
        version: uploadedPricing.version,
        _collectionId: collectionId,
        _organizationId: organizationId,
        private: isPrivate,
        currency: uploadedPricing.currency,
        // A forked version is "created" now, when it's added to the destination pricing,
        // not when the original version being copied was authored.
        createdAt: createdAtOverride ?? new Date(uploadedPricing.createdAt),
        url: '',
        yaml: yamlPath,
        analytics: {},
      };

      const pricing = await this.pricingRepository.create([pricingData]);

      if (!isAddingVersion && orgRole === 'MEMBER') {
        try {
          await this.permissionService.grantEntityPermission(
            reqUser.id,
            organizationId,
            'pricing',
            pricingSlug,
            { GET: true, PUT: true, DELETE: true, CREATE: true }
          );
        } catch {
          // Permission grant failure should not block pricing creation
        }
      }

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
      const error = err as Error & { code?: number };
      if (error.code === 11000 || error.message.includes('E11000')) {
        const pricingName = name || uploadedPricing?.saasName || 'Pricing';
        const pricingVersion = uploadedPricing?.version || 'requested version';
        throw new Error(
          `CONFLICT: ${pricingName} version ${pricingVersion} already exists. Change the version in the YAML before publishing.`
        );
      }
      throw new Error(error.message);
    }
  }

  async addPricingToCollection(
    pricingSlug: string,
    organizationId: string,
    collectionSlug: string,
    reqUser?: LeanUser
  ) {
    try {
      const collection = await this.pricingCollectionService.show(
        organizationId,
        collectionSlug,
        reqUser
      );

      if (reqUser) {
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
          action: 'PUT',
          isPrivate: collection.private,
          userOrgRole: orgRole,
          isGlobalAdmin: reqUser.role === 'ADMIN',
          entityPermissions: entityPerms,
        });
        if (!evalResult.allowed) {
          throw new Error(`PERMISSION ERROR: ${evalResult.reason}`);
        }
      }

      const pricing = await this.pricingRepository.findOne(pricingSlug, organizationId, {
        includePrivate: true,
      });
      if (!pricing) {
        throw new Error(
          "NOT FOUND: Pricing not found. Please check that: 1) the pricing is created, 2) that you're a member of the organization, and 3) that the collectionName you've specified is correct (the collectionName is case-sensitive)."
        );
      }

      await this.pricingRepository.addPricingToCollection(
        pricingSlug,
        organizationId,
        collection.id
      );
      await this.pricingCollectionService.updateCollectionAnalytics(collection.id);

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

    if (data.name) {
      const baseSlug = generateSlug(data.name);
      data.slug = await deduplicateSlug(baseSlug, async (slug) => {
        return this.pricingRepository.findExistingSlug(slug, effectiveOrgId);
      });
    }

    for (const pricingVersion of pricing.versions) {
      await this.pricingRepository.update(pricingVersion.id, data);
    }

    if (data.name) {
      const staticFolder = process.env.SERVER_STATICS_FOLDER || 'public/';
      const processedPaths = new Set<string>();

      for (const pricingVersion of pricing.versions) {
        const yamlRelativePath = pricingVersion.yaml;
        if (!yamlRelativePath || processedPaths.has(yamlRelativePath)) continue;

        processedPaths.add(yamlRelativePath);
        const absolutePath = path.resolve(staticFolder, yamlRelativePath);

        if (!fs.existsSync(absolutePath)) continue;

        const yamlContent = fs.readFileSync(absolutePath, 'utf8');
        const yamlData = yaml.load(yamlContent) as Record<string, any>;
        if (yamlData && typeof yamlData === 'object') {
          yamlData['saasName'] = data.name;
          fs.writeFileSync(absolutePath, yaml.dump(yamlData, { lineWidth: -1 }), 'utf8');
        }
      }
    }

    const effectiveSlug = data.slug || pricingSlug;
    const updatedPricing = await this.pricingRepository.findOne(effectiveSlug, effectiveOrgId, {
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

    const result = await this.pricingRepository.destroyBySlugOrganizationAndCollectionId(
      pricingSlug,
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

    result = await this.pricingRepository.destroyVersionBySlugAndOrganization(
      pricingSlug,
      pricingVersion,
      organizationId
    );

    if (!result) {
      result = await this.pricingRepository.destroyVersionBySlugAndOrganization(
        pricingSlug,
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
