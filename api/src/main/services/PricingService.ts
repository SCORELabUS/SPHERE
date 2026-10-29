import { formatPricingEtag, PreconditionFailedError, PricingRevisionContext } from '../utils/pricing-etag';
import { withPricingRevisionLock, withPricingRevisionLocks } from '../utils/pricing-revision-lock';
import { Pricing } from 'pricing4ts';
import { Pricing as PricingModel } from '../types/database/Pricing';
import { ForkedFrom } from '../types/models/Pricing';
import container from '../config/container';
import { processFileUris } from './FileService';
import { sanitizePathSegment } from '../utils/path-utils';
import { requirePricingFile, resolvePricingFile } from '../utils/pricing-files';
import { stampCreatedAt } from '../utils/created-at';
import { permanentYamlPath } from '../utils/permanent-links';
import {
  PricingService as PricingAnalytics,
  retrievePricingFromPath,
  retrievePricingFromText,
} from 'pricing4ts/server';
import { PricingIndexQueryParams } from '../types/services/PricingService';
import PricingCollectionService from './PricingCollectionService';
import PricingRepository from '../repositories/mongoose/PricingRepository';
import CacheService, { INTERNAL_CACHE_PREFIX } from './CacheService';
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
import mongoose from 'mongoose';

/**
 * What a client may change with `PUT /pricings/{organizationId}/{slug}`. The
 * rest of a version is the server's: its file (`yaml`), organization,
 * collection (moved through the collection endpoints, which check the
 * collection's permissions), identity, label, dates and analytics.
 */
export const CLIENT_PRICING_FIELDS = ['name', 'private', 'url'] as const;

interface RevisionReader {
  reqUser: LeanUser;
  organizationId: string;
  slug: string;
  collectionSlug?: string;
}

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
    // The global ADMIN bypass is a token's only, never an API key's.
    const isAdmin = reqUser && reqUser.role === 'ADMIN' && !(reqUser as any).apiKey;

    const pricings = await this.pricingRepository.findAll(
      queryParams,
      {
        orgRole: null,
        pricings: [],
        collections: [],
        isGlobalAdmin: isAdmin ?? false,
        adminOrgIds: [],
      },
      await this.permissionService.visiblePrivateCollections(reqUser)
    );
    return pricings;
  }

  async indexByOrganizationId(
    organizationId: string,
    reqUser?: LeanUser,
    queryParams?: PricingIndexQueryParams
  ) {
    // An API key acts within its scopes (a VIEW key as a plain member), as
    // when reading one pricing.
    const access = await this.permissionService.actingAccess(reqUser, organizationId);
    const orgRole: OrgRole | null = access.role;

    const collectionVisibility = await this.permissionService.visiblePrivateCollections(reqUser);

    if (!reqUser || !access.reachable || (!access.isGlobalAdmin && !orgRole)) {
      const pricings = await this.pricingRepository.findByOrganizationId(
        organizationId,
        { orgRole: null, pricings: [], collections: [], isGlobalAdmin: false, adminOrgIds: [] },
        queryParams ?? { limit: 10, offset: 0 },
        collectionVisibility
      );
      return pricings;
    }

    const permissions = await this.permissionService.buildOrgUserPermissionsContext(
      access.isGlobalAdmin ? reqUser : { ...reqUser, role: 'USER' },
      orgRole,
      organizationId
    );

    const pricings = await this.pricingRepository.findByOrganizationId(
      organizationId,
      permissions,
      queryParams ?? { limit: 10, offset: 0 },
      collectionVisibility
    );

    return pricings;
  }

  async indexByUser(username: string, reqUser: LeanUser, queryParams?: PricingIndexQueryParams) {
    const viaKey = Boolean((reqUser as any).apiKey);
    if (username !== reqUser.username && (reqUser.role !== 'ADMIN' || viaKey)) {
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
    // With an API key, only what the key reaches and as it acts there.
    const permissions = await this.permissionService.narrowListingToCaller(
      reqUser,
      await this.permissionService.buildUserPermissionsContext(user)
    );
    const enhancedQueryParams = {
      ...queryParams,
      limit: queryParams?.limit ?? 10,
      offset: queryParams?.offset ?? 0,
      ...(permissions.isGlobalAdmin ? {} : { selectedOrganizations: userOrganizationsIds }),
    };
    const pricings = await this.pricingRepository.findAll(
      enhancedQueryParams,
      permissions,
      await this.permissionService.visiblePrivateCollections(reqUser)
    );
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
    queryParams: { collection?: string; collectionId?: string; includePrivate?: boolean } = {}
  ) {
    const { collection: collectionFilter, collectionId: collectionIdFilter, ...lookup } = queryParams;
    const pricing: {
      pricingId?: string;
      name: string;
      slug: string;
      collection?: { id?: string | null; name?: string; slug?: string };
      versions: (PricingModel & { id?: string; private?: boolean; collectionName?: string | null; forkedFrom?: any })[];
    } | null = await this.pricingRepository.findOne(slug, organizationId, {
      ...lookup,
      includePrivate: true,
    });

    const collectionVisible = pricing ? await this._canSeeCollectionOf(reqUser, organizationId, pricing) : false;
    if (!pricing || !this._matchesCollectionFilter(pricing, collectionVisible, collectionFilter, collectionIdFilter)) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    if (!(await this._canSeePrivateVersions(reqUser, organizationId, slug, pricing.collection?.slug))) {
      pricing.versions = pricing.versions.filter(version => !version.private);
    }

    if (pricing.versions.length === 0) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    if (!collectionVisible) {
      this._hideCollection(pricing);
    }
    await this._hideCollectionFolders(pricing, reqUser);
    await this._hideForkSourceCollections(pricing.versions, reqUser);

    for (const version of pricing.versions) {
      processFileUris(version, ['yaml']);
    }

    return pricing;
  }

  /**
   * Whether the caller may see the collection a pricing found by
   * `findOne` belongs to (true when it is in none).
   */
  private async _canSeeCollectionOf(
    reqUser: LeanUser | undefined,
    organizationId: string,
    pricing: { collection?: { id?: string | null; slug?: string } }
  ): Promise<boolean> {
    if (!pricing.collection?.id) return true;
    const collection = await this.pricingCollectionService.findRef(pricing.collection.id);
    if (!collection) return true;
    return this.permissionService.canViewCollection(reqUser, { ...collection, organizationId });
  }

  /**
   * The `collection` (slug) and `collectionId` filters of a pricing request. A
   * collection the caller may not see never matches, exactly as if the pricing
   * were in no collection, so the filters cannot be used to find it out.
   */
  private _matchesCollectionFilter(
    pricing: { collection?: { id?: string | null; slug?: string } },
    collectionVisible: boolean,
    collectionSlug?: string,
    collectionId?: string
  ): boolean {
    if (!collectionSlug && !collectionId) return true;
    if (!collectionVisible || !pricing.collection?.id) return false;
    if (collectionSlug && pricing.collection.slug !== collectionSlug) return false;
    if (collectionId && pricing.collection.id !== String(collectionId)) return false;
    return true;
  }

  /**
   * Strips a private collection the caller may not see from a pricing: no
   * name, slug or id, and the YAML of each (public) version is linked through
   * its permanent route, since the stored file path carries the collection's
   * folder.
   */
  private _hideCollection(pricing: {
    pricingId?: string;
    collection?: { id?: string | null; name?: string; slug?: string };
    versions: Array<{ id?: string; private?: boolean; yaml: string; _collectionId?: unknown; collectionName?: unknown }>;
  }) {
    pricing.collection = { id: null };
    for (const version of pricing.versions) {
      version._collectionId = null;
      version.collectionName = null;
      if (!version.private && pricing.pricingId && version.id) {
        version.yaml = permanentYamlPath(pricing.pricingId, version.id);
      }
    }
  }

  /**
   * Files uploaded with a collection (ZIP upload) are stored in its folder,
   * `static/collections/{organizationId}/{collection name or slug}/...`, so the
   * path of a public version names the collection even when the pricing is no
   * longer (or was never) linked to it. Unless the caller may see the
   * collection that folder belongs to, such a version is linked through its
   * permanent route instead.
   */
  private async _hideCollectionFolders(
    pricing: { pricingId?: string; versions: Array<{ id?: string; private?: boolean; yaml: string }> },
    reqUser?: LeanUser
  ) {
    const visibleFolders = new Map<string, boolean>();
    for (const version of pricing.versions) {
      const folder = /^\/?static\/collections\/([^/]+)\/([^/]+)\//.exec(version.yaml ?? '');
      if (!folder || version.private || !pricing.pricingId || !version.id) continue;
      const key = `${folder[1]}/${folder[2]}`;
      if (!visibleFolders.has(key)) {
        const collection = await this.pricingCollectionService.findRefByFolder(folder[1], folder[2]);
        visibleFolders.set(key, !!collection && (await this.permissionService.canViewCollection(reqUser, collection)));
      }
      if (!visibleFolders.get(key)) {
        version.yaml = permanentYamlPath(pricing.pricingId, version.id);
      }
    }
  }

  /** A fork names the collection of its source only to those who may see that collection. */
  private async _hideForkSourceCollections(versions: Array<{ forkedFrom?: any }>, reqUser?: LeanUser) {
    for (const version of versions) {
      const origin = version.forkedFrom;
      if (!origin?.collectionId) continue;
      const collection = await this.pricingCollectionService.findRef(String(origin.collectionId));
      const visible = !collection || (await this.permissionService.canViewCollection(reqUser, collection));
      if (!visible) {
        const { collectionId: _id, collectionName: _name, collectionSlug: _slug, ...rest } = origin;
        version.forkedFrom = rest;
      }
    }
  }

  /**
   * Whether the user may see the private versions of a pricing, on the same
   * grounds the listings use: global admin, OWNER/ADMIN of its organization, or
   * an explicit GET permission on the pricing or on its collection. Anyone else
   * only gets the public versions.
   */
  private async _canSeePrivateVersions(
    reqUser: LeanUser | undefined,
    organizationId: string,
    pricingSlug: string,
    collectionSlug?: string
  ): Promise<boolean> {
    // One rule for every read of private versions, API key scopes included.
    return this.permissionService.canReadPrivateVersions(reqUser, {
      organizationId,
      slug: pricingSlug,
      collectionSlug,
    });
  }

  /**
   * `findOne` (every version) with the `collection`/`collectionId` filters a
   * request may carry, applied as `_matchesCollectionFilter` does.
   */
  private async _findForCaller(
    slug: string,
    organizationId: string,
    reqUser: LeanUser | undefined,
    queryParams: { collection?: string; collectionId?: string; [key: string]: unknown }
  ) {
    const { collection: collectionFilter, collectionId: collectionIdFilter } = queryParams;
    const pricing = await this.pricingRepository.findOne(slug, organizationId, {
      includePrivate: true, collection: collectionFilter, collectionId: collectionIdFilter,
    });
    if (!pricing) return null;
    const visible = await this._canSeeCollectionOf(reqUser, organizationId, pricing);
    return this._matchesCollectionFilter(pricing, visible, collectionFilter, collectionIdFilter) ? pricing : null;
  }

  /** A pricing as returned after a change, without a collection the caller may not see. */
  private async _withoutHiddenCollection(pricing: any, organizationId: string, reqUser?: LeanUser) {
    if (!pricing) return pricing;
    if (!(await this._canSeeCollectionOf(reqUser, organizationId, pricing))) {
      this._hideCollection(pricing);
    }
    await this._hideCollectionFolders(pricing, reqUser);
    await this._hideForkSourceCollections(pricing.versions ?? [], reqUser);
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

    const { collection: collectionFilter, collectionId: collectionIdFilter } = (queryParams ?? {}) as {
      collection?: string;
      collectionId?: string;
    };
    const retrievedPricing = await this.pricingRepository.findOne(
      pricingSlug,
      organizationId,
      {
        version: pricingVersion,
        includePrivate: true,
      }
    );
    const canSeeVersion = retrievedPricing && (
      !retrievedPricing.versions[0]?.private ||
      await this._canSeePrivateVersions(reqUser, organizationId, pricingSlug, retrievedPricing.collection?.slug)
    ) && this._matchesCollectionFilter(
      retrievedPricing,
      await this._canSeeCollectionOf(reqUser, organizationId, retrievedPricing),
      collectionFilter,
      collectionIdFilter
    );
    if (!retrievedPricing || !canSeeVersion) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    if (!process.env.SERVER_STATICS_FOLDER) {
      throw new Error('SERVER_STATICS_FOLDER env not set');
    }

    let configurationSpace = null;
    // Under the server's own prefix: the public /cache endpoint can neither read
    // it (a private version's configuration space) nor plant a forged one.
    const key: string = `${INTERNAL_CACHE_PREFIX}configuration-space:${organizationId}.${pricingSlug}.${pricingVersion}`;
    const cachedConfigurationSpace = await this.cacheService.get(key);

    if (cachedConfigurationSpace) {
      configurationSpace = cachedConfigurationSpace;
    } else {
      // Configuariton space calculation
      const pricingInfo: Pricing = retrievePricingFromPath(requirePricingFile(retrievedPricing.versions[0].yaml));
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
    name?: string,
    revisionContext?: PricingRevisionContext
  ) {
    return this._createPricingVersion(
      pricingFile,
      organizationId,
      isPrivate,
      reqUser,
      collectionId,
      undefined,
      name,
      undefined,
      undefined,
      undefined,
      revisionContext
    );
  }

  async createVersion(
    pricingFile: any,
    organizationId: string,
    pricingSlug: string,
    isPrivate: boolean,
    reqUser: LeanUser,
    collectionId?: string,
    createdAt?: Date,
    revisionContext?: PricingRevisionContext
  ) {
    return this._createPricingVersion(
      pricingFile,
      organizationId,
      isPrivate,
      reqUser,
      collectionId,
      pricingSlug,
      undefined,
      undefined,
      undefined,
      createdAt,
      revisionContext
    );
  }

  /**
   * Forks one version of a pricing into another organization.
   *
   * A fork is a single branching point: it always creates a NEW pricing in the target
   * organization and never adds a version to an existing one (forked or not). When the name
   * the fork would take (`options.name`, or the source's own name) already belongs to a
   * pricing in the target organization, nothing is written: without `options.name` the
   * caller gets back `{ nameTaken: true, ... }` so the UI can ask for another name, and
   * with it the request fails with a CONFLICT.
   */
  async forkPricing(
    sourceOrganizationId: string,
    sourceSlug: string,
    sourceVersion: string,
    targetOrganizationId: string,
    reqUser: LeanUser,
    options: { name?: string } = {}
  ) {
    if (sourceOrganizationId === targetOrganizationId) {
      throw new Error('INVALID DATA: Cannot fork a pricing into its own organization');
    }

    const sourcePricing = await this.pricingRepository.findOne(sourceSlug, sourceOrganizationId, {
      version: sourceVersion,
      includePrivate: true,
    });

    if (!sourcePricing || !sourcePricing.versions?.length || !sourcePricing.pricingId) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    // A version is forkable by whoever can already read it, by the same rule as
    // show(): a public one by anyone, a private one only by who may read the
    // private versions of its pricing. Anyone else is told it does not exist.
    if (
      sourcePricing.versions[0].private === true &&
      !(await this._canSeePrivateVersions(reqUser, sourceOrganizationId, sourceSlug, (sourcePricing as any).collection?.slug))
    ) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    const sourceVersionDoc = sourcePricing.versions[0];

    const sourceAbsolutePath = resolvePricingFile(sourceVersionDoc.yaml);
    if (!sourceAbsolutePath || !fs.existsSync(sourceAbsolutePath)) {
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
      const requestedName = options.name?.trim();
      const forkedPricingName = requestedName || sourcePricing.name;
      const nameClash = await this.pricingRepository.findOne(
        generateSlug(forkedPricingName),
        targetOrganizationId,
        { includePrivate: true }
      );

      if (nameClash?.versions?.length) {
        if (!requestedName) {
          // Nothing gets written: the draft copy was only needed to read the YAML above.
          if (fs.existsSync(copiedAbsolutePath)) {
            fs.rmSync(copiedAbsolutePath);
          }
          return {
            nameTaken: true as const,
            existingPricing: { name: nameClash.name, slug: nameClash.slug },
            sourceVersion: sourceVersionDoc.version,
          };
        }
        throw new Error(
          `CONFLICT: A pricing named "${nameClash.name}" already exists in this organization. A fork always creates a new pricing, so choose a different name.`
        );
      }

      const sourceOrganization = (sourceVersionDoc as any).organization;
      // The source's collection is recorded only when the one forking may see it.
      const sourceCollection = (await this._canSeeCollectionOf(reqUser, sourceOrganizationId, sourcePricing))
        ? (sourcePricing as any).collection
        : null;

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

      const pricing = await this._createPricingVersion(
        { path: copiedAbsolutePath },
        targetOrganizationId,
        sourceVersionDoc.private === true,
        reqUser,
        undefined,
        undefined,
        forkedPricingName,
        forkedFrom,
        null,
        new Date()
      );
      // From here on the stored version references the copied file, so it must not
      // be deleted if anything after this point fails.
      versionCreated = true;

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
    createdAtOverride?: Date,
    revisionContext?: PricingRevisionContext
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

      // A new pricing placed in a collection edits that collection: it must be
      // one of this organization that the caller may edit, as when adding a
      // pricing to it. A new version stays in its pricing's collection.
      if (collectionId && !isAddingVersion) {
        await this._checkCollectionTarget(reqUser, organizationId, String(collectionId));
      }

      if (!collectionId && previousPricing && previousPricing.versions[0]._collectionId) {
        collectionId = previousPricing.versions[0]._collectionId.toString();
      }

      // The release instant lives both in the database and in the YAML. When the
      // caller dictates it (a new version's release time, a fork's creation time),
      // the stored YAML must say the same.
      if (createdAtOverride && createdAtOverride.getTime() !== new Date(uploadedPricing.createdAt).getTime()) {
        const stampedPath = typeof pricingFile === 'string' ? pricingFile : pricingFile.path;
        fs.writeFileSync(stampedPath, stampCreatedAt(fs.readFileSync(stampedPath, 'utf8'), createdAtOverride), 'utf8');
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

      const reader = { reqUser, organizationId, slug: pricingSlug, collectionSlug: isAddingVersion ? previousPricing.collection?.slug : undefined };
      const parsedPricing = uploadedPricing;
      return await this._withRevisionClaim(isAddingVersion ? previousPricing.pricingId : undefined, revisionContext, reader, async () => {
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

        if (pricingName !== parsedPricing.saasName) {
          const finalYamlPath = requirePricingFile(yamlPath);
          const yamlContent = fs.readFileSync(filePath, 'utf8');
          const yamlData = yaml.load(yamlContent) as Record<string, any>;
          if (yamlData && typeof yamlData === 'object') {
            yamlData['saasName'] = pricingName;
            fs.mkdirSync(path.dirname(finalYamlPath), { recursive: true });
            fs.writeFileSync(finalYamlPath, yaml.dump(yamlData, { lineWidth: -1 }), 'utf8');
          }
        }

        processFileUris(pricing[0], ['yaml']);

        // A version added to a pricing that sits in a private collection the
        // author cannot see does not name that collection back.
        if (collectionId) {
          const collection = await this.pricingCollectionService.findRef(String(collectionId));
          if (collection && !(await this.permissionService.canViewCollection(reqUser, collection))) {
            delete (pricing[0] as any)._collectionId;
          }
        }

        const pricingAnalytics = new PricingAnalytics(parsedPricing);
        await pricingAnalytics
          .getAnalytics()
          // Awaited, so the collection's analytics below already count this version.
          .then((analytics: any) => this.pricingRepository.updateAnalytics(pricing[0]._id.toString(), analytics))
          // Missing analytics must not prevent publishing an otherwise usable pricing.
          .catch((err: any) => {
            console.warn(`Could not compute the analytics of pricing version ${pricing[0]._id}: ${(err as Error).message}`);
          });

        if (collectionId) {
          await this.pricingCollectionService.updateCollectionAnalytics(collectionId);
        }

        if (isAddingVersion && !forkedFrom) {
          // Not awaited: telling followers must not delay or fail the publish itself.
          void container
            .resolve('pricingFollowService')
            .notifyNewVersion({ ...pricingData, pricingId: previousPricing.pricingId }, reqUser)
            .catch((error: unknown) => console.error('[Pricing follow] Could not notify followers:', error));
        }

        if (!isAddingVersion && revisionContext) delete revisionContext.mayRead;
        await this._setEtag(pricing[0].pricingId, revisionContext, reader);
        return pricing;
      });
    } catch (err) {
      if (err instanceof PreconditionFailedError) throw err;
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
      const notFound =
        "NOT FOUND: Pricing not found. Please check that: 1) the pricing is created, 2) that you're a member of the organization, and 3) that the collectionName you've specified is correct (the collectionName is case-sensitive).";
      if (!pricing) {
        throw new Error(notFound);
      }

      // Whoever may read a collection inherits GET on the pricings in it, so
      // a pricing with private versions only goes in by the hand of someone
      // who may already read them. One whose versions the caller cannot see
      // at all answers as a missing one.
      if (
        reqUser &&
        pricing.versions.some((version: { private?: boolean }) => version.private === true) &&
        !(await this._canSeePrivateVersions(reqUser, organizationId, pricingSlug, pricing.collection?.slug))
      ) {
        if (pricing.versions.every((version: { private?: boolean }) => version.private === true)) {
          throw new Error(notFound);
        }
        throw new Error('PERMISSION ERROR: You cannot add this pricing to a collection');
      }

      // Moving a pricing out of a private collection the caller may not see
      // would change that collection, and is refused without naming it.
      if (reqUser && !(await this._canSeeCollectionOf(reqUser, organizationId, pricing))) {
        throw new Error('PERMISSION ERROR: This pricing cannot be added to the collection');
      }

      if (reqUser) await this.permissionService.assertPricingMove(reqUser, organizationId, pricingSlug, collection.slug, pricing);

      await this.pricingRepository.addPricingToCollection(
        pricingSlug,
        organizationId,
        collection.id,
        pricing.pricingId
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
    queryParams: { collectionSlug?: string; organizationId?: string } = {},
    revisionContext?: PricingRevisionContext
  ) {
    data = this._clientPricingChanges(data);
    const effectiveOrgId = queryParams.organizationId || organizationId;

    const pricing = await this._findForCaller(pricingSlug, effectiveOrgId, reqUser, queryParams);
    if (!pricing) {
      throw new Error(
        'NOT FOUND: Either the pricing does not exist or you are not a member of its organization'
      );
    }

    const updateResult = await this.permissionService.checkPricingPut(reqUser, effectiveOrgId, pricingSlug, { pricing, isPrivate: pricing.versions.some((version: { private?: boolean }) => version.private === true) });
    if (!updateResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${updateResult.reason}`);
    }

    // Moving the pricing between collections this way must not reach into a
    // private collection the caller may not see, as source or as destination.
    if (Object.prototype.hasOwnProperty.call(data, '_collectionId')) {
      const target = data._collectionId ? await this.pricingCollectionService.findRef(String(data._collectionId)) : null;
      const allowed =
        (await this._canSeeCollectionOf(reqUser, effectiveOrgId, pricing)) &&
        (!target || (await this.permissionService.canViewCollection(reqUser, target)));
      if (!allowed) {
        throw new Error('PERMISSION ERROR: This pricing cannot be moved to that collection');
      }
    }

    if (data.name) {
      const baseSlug = generateSlug(data.name);
      data.slug = await deduplicateSlug(baseSlug, async (slug) => {
        return this.pricingRepository.findExistingSlug(slug, effectiveOrgId);
      });
    }

    const reader = { reqUser, organizationId: effectiveOrgId, slug: pricingSlug, collectionSlug: pricing.collection?.slug };
    return this._withRevisionClaim(pricing.pricingId, revisionContext, reader, async () => {
      for (const pricingVersion of pricing.versions) {
        await this.pricingRepository.update(pricingVersion.id, data);
      }

      if (data.name) {
        const processedPaths = new Set<string>();

        for (const pricingVersion of pricing.versions) {
          const yamlRelativePath = pricingVersion.yaml;
          if (!yamlRelativePath || processedPaths.has(yamlRelativePath)) continue;

          processedPaths.add(yamlRelativePath);
          // Never a file outside the pricing folders, whatever the row says.
          const absolutePath = resolvePricingFile(yamlRelativePath);

          if (!absolutePath || !fs.existsSync(absolutePath)) continue;

          const yamlContent = fs.readFileSync(absolutePath, 'utf8');
          const yamlData = yaml.load(yamlContent) as Record<string, any>;
          if (yamlData && typeof yamlData === 'object') {
            yamlData['saasName'] = data.name;
            fs.writeFileSync(absolutePath, yaml.dump(yamlData, { lineWidth: -1 }), 'utf8');
          }
        }
      }

      await this._setEtag(pricing.pricingId, revisionContext, reader);
      const effectiveSlug = data.slug || pricingSlug;
      const updatedPricing = await this.pricingRepository.findOne(effectiveSlug, effectiveOrgId, {
        includePrivate: true, collectionId: pricing.versions[0]?._collectionId ?? undefined,
      });

      return this._withoutHiddenCollection(await this._withReadableVersions(updatedPricing, effectiveOrgId, reqUser), effectiveOrgId, reqUser);
    });
  }

  /** A pricing as returned after a change: its private versions only for who may read them. */
  private async _withReadableVersions(pricing: any, organizationId: string, reqUser?: LeanUser) {
    if (!pricing?.versions) return pricing;
    if (!(await this._canSeePrivateVersions(reqUser, organizationId, pricing.slug, pricing.collection?.slug))) {
      pricing.versions = pricing.versions.filter((version: { private?: boolean }) => version.private !== true);
    }
    return pricing;
  }

  /**
   * The changes a client sent to `update`, refused with INVALID DATA when they
   * touch a field the server manages (see `CLIENT_PRICING_FIELDS`). The slug
   * always follows the name.
   */
  private _clientPricingChanges(data: unknown): { name?: string; private?: boolean; url?: string; slug?: string } {
    const body = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    const refused = Object.keys(body).filter(key => !(CLIENT_PRICING_FIELDS as readonly string[]).includes(key));
    if (refused.length > 0) {
      throw new Error(
        `INVALID DATA: ${refused.join(', ')} cannot be changed: only ${CLIENT_PRICING_FIELDS.join(', ')} can. ` +
          'Move a pricing between collections with POST /collections/{organizationId}/{collectionSlug} and ' +
          'DELETE /collections/{organizationId}/{collectionSlug}/pricings/{pricingSlug}.'
      );
    }
    const changes: { name?: string; private?: boolean; url?: string } = {};
    if (body.name !== undefined) changes.name = String(body.name);
    if (body.private !== undefined) changes.private = body.private === true || body.private === 'true';
    if (body.url !== undefined) changes.url = String(body.url);
    return changes;
  }

  /**
   * A collection a new pricing is placed in: one of the same organization
   * that the caller may edit, by the check `addPricingToCollection` makes.
   * One the caller may not see answers as one that does not exist.
   */
  private async _checkCollectionTarget(reqUser: LeanUser, organizationId: string, collectionId: string) {
    const collection: any = mongoose.isValidObjectId(collectionId)
      ? await container.resolve('pricingCollectionRepository').findById(collectionId)
      : null;
    if (!collection || String(collection.organization?.id ?? '') !== String(organizationId)) {
      throw new Error('NOT FOUND: Collection not found');
    }
    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, organizationId);
    const batchCtx = await this.permissionService.buildBatchContext(reqUser.id, organizationId, orgRole, reqUser.role === 'ADMIN');
    const entityPermissions = batchCtx.entityPermissions.get(`collection:${collection.slug}`);
    const evaluation = { userId: reqUser.id, organizationId, entityType: 'collection' as const, entitySlug: collection.slug,
      isPrivate: collection.private === true, userOrgRole: orgRole, isGlobalAdmin: reqUser.role === 'ADMIN', entityPermissions };
    if (!this.permissionEngine.evaluate({ ...evaluation, action: 'GET' }).allowed) {
      throw new Error('NOT FOUND: Collection not found');
    }
    const result = this.permissionEngine.evaluate({ ...evaluation, action: 'PUT' });
    if (!result.allowed) {
      throw new Error(`PERMISSION ERROR: ${result.reason}`);
    }
  }

  /**
   * Changes the visibility of one version only. The rest of the pricing keeps
   * its own; `update` is what changes every version at once.
   */
  async updateVersionVisibility(
    pricingSlug: string,
    pricingVersion: string,
    organizationId: string,
    reqUser: LeanUser,
    isPrivate: boolean,
    revisionContext?: PricingRevisionContext,
    collectionSlug?: string
  ) {

    const pricing = await this.pricingRepository.findOne(pricingSlug, organizationId, {
      includePrivate: true, collection: collectionSlug,
    });
    const target = pricing?.versions.find(
      (version: { version: string }) =>
        [pricingVersion, pricingVersion.replace('_', '.')].some(
          candidate => version.version.toLowerCase() === candidate.toLowerCase()
        )
    );
    if (!pricing || !target) {
      throw new Error('NOT FOUND: Pricing version not found');
    }

    const updateResult = await this.permissionService.checkPricingPut(reqUser, organizationId, pricingSlug, { pricing, isPrivate: target.private === true });
    if (!updateResult.allowed) {
      throw new Error(`PERMISSION ERROR: ${updateResult.reason}`);
    }

    const reader = { reqUser, organizationId, slug: pricingSlug, collectionSlug: pricing.collection?.slug };
    return this._withRevisionClaim(pricing.pricingId, revisionContext, reader, async () => {
      await this.pricingRepository.update(target.id, { private: isPrivate });
      await this._setEtag(pricing.pricingId, revisionContext, reader);

      return this._withoutHiddenCollection(await this._withReadableVersions(
        await this.pricingRepository.findOne(pricingSlug, organizationId, { includePrivate: true, collectionId: pricing.versions[0]?._collectionId ?? undefined }),
        organizationId,
        reqUser
      ), organizationId, reqUser);
    });
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
    queryParams: { collectionSlug?: string; organizationId?: string } = {},
    revisionContext?: PricingRevisionContext
  ) {
    const effectiveOrgId = queryParams.organizationId || organizationId;
    let collectionId: string | undefined;

    const orgRole = await this.permissionService.resolveOrgRole(reqUser.id, effectiveOrgId);

    const pricing = await this._findForCaller(pricingSlug, effectiveOrgId, reqUser, queryParams);

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

    return this._withRevisionClaim(pricing.pricingId, revisionContext, { reqUser, organizationId: effectiveOrgId, slug: pricingSlug, collectionSlug: pricing.collection?.slug }, async () => {
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
    });
  }

  async destroyVersion(
    pricingSlug: string,
    pricingVersion: string,
    organizationId: string,
    reqUser: LeanUser,
    revisionContext?: PricingRevisionContext
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

    if (revisionContext?.precondition && !pricing.versions.some((candidate: { version: string }) => [pricingVersion, pricingVersion.replace('_', '.')].includes(candidate.version))) {
      throw new Error('NOT FOUND: Pricing version not found');
    }
    const reader = { reqUser, organizationId, slug: pricingSlug, collectionSlug: pricing.collection?.slug };
    return this._withRevisionClaim(pricing.pricingId, revisionContext, reader, async () => {
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

      await this._setEtag(pricing.pricingId, revisionContext, reader);
      return true;
    });
  }

  async showWithEtag(...args: Parameters<PricingService['show']>) {
    const [slug, organizationId] = args;
    let ids = [...(await this.pricingRepository.findRevisionsBySlug(slug, organizationId)).keys()];
    for (;;) {
      const result = await withPricingRevisionLocks(ids, () => this._showWithEtag(...args));
      const pricingId = (result.pricing as { pricingId?: string }).pricingId;
      if (!pricingId || ids.includes(pricingId)) return result;
      // A pricing can be created or renamed into this slug during the first
      // lookup. Discard that snapshot and read again under its stable id.
      ids = [pricingId];
    }
  }

  private async _showWithEtag(...args: Parameters<PricingService['show']>) {
    const [slug, organizationId, reqUser] = args;
    const revisions = await this.pricingRepository.findRevisionsBySlug(slug, organizationId);
    const pricing = await this.show(...args);
    const pricingId = (pricing as { pricingId?: string }).pricingId;
    let etag: string | undefined;
    if (
      pricingId &&
      (await this._canSeePrivateVersions(reqUser, organizationId, slug, pricing.collection?.slug))
    ) {
      const revision = revisions.get(pricingId) ?? (await this.pricingRepository.findRevision(pricingId));
      if (revision !== null) etag = formatPricingEtag(pricingId, revision);
    }
    return { pricing, etag };
  }

  private async _mayReadRevision(revisionContext: PricingRevisionContext, reader: RevisionReader) {
    if (revisionContext.mayRead === undefined) {
      revisionContext.mayRead = await this._canSeePrivateVersions(
        reader.reqUser,
        reader.organizationId,
        reader.slug,
        reader.collectionSlug
      );
    }
    return revisionContext.mayRead;
  }

  private async _withRevisionClaim<T>(
    pricingId: string | undefined,
    revisionContext: PricingRevisionContext | undefined,
    reader: RevisionReader,
    write: () => Promise<T>
  ): Promise<T> {
    const claimedWrite = async () => {
      await this._claimRevision(pricingId, revisionContext, reader);
      return write();
    };
    return pricingId ? withPricingRevisionLock(String(pricingId), claimedWrite) : claimedWrite();
  }

  private async _claimRevision(
    pricingId: string | undefined,
    revisionContext: PricingRevisionContext | undefined,
    reader: RevisionReader
  ) {
    if (!revisionContext) return;
    const mayRead = await this._mayReadRevision(revisionContext, reader);
    const precondition = revisionContext.precondition;
    if (!precondition) return;
    const mayMatch = mayRead || precondition.kind === 'any';
    if (mayMatch && pricingId && (await this.pricingRepository.claimRevision(pricingId, precondition))) return;
    throw new PreconditionFailedError(pricingId && mayRead ? await this._etagOf(pricingId) : undefined);
  }

  private async _etagOf(pricingId: string): Promise<string | undefined> {
    const revision = await this.pricingRepository.findRevision(pricingId);
    return revision === null ? undefined : formatPricingEtag(pricingId, revision);
  }

  private async _setEtag(pricingId: unknown, revisionContext: PricingRevisionContext | undefined, reader: RevisionReader) {
    if (!revisionContext) return;
    const mayRead = await this._mayReadRevision(revisionContext, reader);
    revisionContext.etag = pricingId && mayRead ? await this._etagOf(String(pricingId)) : undefined;
  }
}

export default PricingService;
