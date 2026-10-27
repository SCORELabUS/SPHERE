import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { Pricing } from 'pricing4ts';
import { retrievePricingFromText } from 'pricing4ts/server';
import container from '../../config/container';
import PricingService from '../PricingService';
import PricingCollectionService from '../PricingCollectionService';
import PricingRepository from '../../repositories/mongoose/PricingRepository';
import { LlmTool } from './OrbitLlmClient';
import { canManage, OrbitActor, resolveOrgRole } from './orbitAccess';
import { matchResource } from './OrbitPlanService';
import { diffPricings } from './orbitPricingDiff';

const MAX_PRICINGS_LISTED = 20;
const MAX_CONFIGURATIONS_LISTED = 20;

/** Read tools over pricings and collections, with the visibility the user has in the web app. */
export const PRICING_TOOLS: LlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_pricings',
      description: `Search pricings by name: in one organization (with the private ones the user may see) or, without organizationId, in the public catalog. Up to ${MAX_PRICINGS_LISTED} results.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to look for in the name; omit to list the latest.' },
          organizationId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pricing',
      description: 'One pricing with its versions (newest first), their visibility and their analytics: plans, add-ons, features, configuration space size and price range.',
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          pricing: { type: 'string', description: 'Name or slug of the pricing.' },
        },
        required: ['organizationId', 'pricing'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_configuration_space',
      description: `The configuration space of one version of a pricing: every valid subscription (plan plus add-ons) with its cost. Returns the size and the first ${MAX_CONFIGURATIONS_LISTED}.`,
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          pricing: { type: 'string', description: 'Name or slug of the pricing.' },
          version: { type: 'string', description: 'Version label as get_pricing lists it.' },
        },
        required: ['organizationId', 'pricing', 'version'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_pricing_versions',
      description: 'What changed between two versions of a pricing: plans and add-ons added, removed or repriced, features and usage limits added or removed, and values that changed inside each plan.',
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          pricing: { type: 'string', description: 'Name or slug of the pricing.' },
          from: { type: 'string', description: 'The older version label.' },
          to: { type: 'string', description: 'The newer version label.' },
        },
        required: ['organizationId', 'pricing', 'from', 'to'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_collection',
      description: 'One collection: its description, visibility, the pricings in it and the page where it can be downloaded.',
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          collection: { type: 'string', description: 'Name or slug of the collection.' },
        },
        required: ['organizationId', 'collection'],
        additionalProperties: false,
      },
    },
  },
];

export const PRICING_TOOL_LABELS: Record<string, string> = {
  search_pricings: 'Searching pricings',
  get_pricing: 'Reading the pricing',
  get_configuration_space: 'Working out the configuration space',
  compare_pricing_versions: 'Comparing the versions',
  get_collection: 'Reading the collection',
};

/** The user as the pricing services expect the caller. */
export function requesterOf(actor: OrbitActor): any {
  return { id: actor.id, username: actor.username, role: actor.role };
}

/**
 * Runs a pricing tool, or answers undefined when the name is not one of them.
 * Visibility is left to the pricing services: they hide what the user may not see.
 */
export async function runPricingTool(name: string, args: any, actor: OrbitActor): Promise<unknown | undefined> {
  const pricingService: PricingService = container.resolve('pricingService');
  const collectionService: PricingCollectionService = container.resolve('pricingCollectionService');
  const user = requesterOf(actor);

  switch (name) {
    case 'search_pricings': {
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 100) : '';
      const params: any = { limit: MAX_PRICINGS_LISTED, offset: 0, ...(query ? { name: query } : {}) };
      const result: any = args.organizationId
        ? await pricingService.indexByOrganizationId(requireOrganizationId(args.organizationId), user, params)
        : await pricingService.index(params, user);
      const pricings: any[] = result?.pricings ?? [];
      return {
        total: result?.total ?? pricings.length,
        pricings: pricings.slice(0, MAX_PRICINGS_LISTED).map(pricing => ({
          name: pricing.name,
          slug: pricing.slug,
          organization: pricing.organization
            ? { id: pricing.organization.id ?? String(pricing.organization._id ?? ''), name: pricing.organization.displayName ?? pricing.organization.name }
            : null,
          latestVersion: pricing.version ?? null,
          private: pricing.private ?? false,
          collection: pricing.collectionName ?? pricing.collection?.name ?? null,
          ...summarizeAnalytics(pricing.analytics),
        })),
      };
    }

    case 'get_pricing': {
      const organizationId = requireOrganizationId(args.organizationId);
      const slug = await resolvePricingSlug(organizationId, args.pricing);
      const pricing: any = await pricingService.show(slug, organizationId, user);
      return {
        name: pricing.name,
        slug: pricing.slug,
        collection: pricing.collection?.name ?? null,
        versions: pricing.versions.slice(0, 30).map((version: any) => ({
          version: version.version,
          private: version.private === true,
          createdAt: version.createdAt,
          forkedFrom: version.forkedFrom
            ? { organization: version.forkedFrom.organizationDisplayName, pricing: version.forkedFrom.name, version: version.forkedFrom.version }
            : null,
          ...summarizeAnalytics(version.analytics),
        })),
        totalVersions: pricing.versions.length,
      };
    }

    case 'get_configuration_space': {
      const organizationId = requireOrganizationId(args.organizationId);
      const slug = await resolvePricingSlug(organizationId, args.pricing);
      const [configurations, size] = await pricingService.getConfigurationSpace(
        organizationId,
        slug,
        String(args.version ?? ''),
        user,
        { limit: String(MAX_CONFIGURATIONS_LISTED), offset: '0' }
      );
      return { size, firstConfigurations: configurations };
    }

    case 'compare_pricing_versions': {
      const organizationId = requireOrganizationId(args.organizationId);
      const slug = await resolvePricingSlug(organizationId, args.pricing);
      // Seen through show() so both versions are ones the user may see.
      const pricing: any = await pricingService.show(slug, organizationId, user);
      const before = await readVersion(organizationId, slug, pricing, args.from);
      const after = await readVersion(organizationId, slug, pricing, args.to);
      // The labels the user sees, rather than the version strings inside the files.
      return { pricing: pricing.name, ...diffPricings(before, after), from: String(args.from), to: String(args.to) };
    }

    case 'get_collection': {
      const organizationId = requireOrganizationId(args.organizationId);
      const slug = await resolveCollectionSlug(organizationId, args.collection);
      // A private collection the user may not see answers as one that does not exist.
      const collection: any = await collectionService.show(organizationId, slug, user).catch((err: Error) => {
        if (err.message.startsWith('NOT FOUND')) throw new Error(`NOT FOUND: There is no collection called "${String(args.collection ?? '').trim()}" in this organization`);
        throw err;
      });
      const pricings = await visiblePricingsIn(organizationId, collection, actor);
      return {
        name: collection.name,
        slug: collection.slug,
        description: collection.description ?? null,
        private: collection.private === true,
        pricings: pricings.slice(0, 100).map(pricing => pricing.name),
        totalPricings: pricings.length,
        page: `/collections/${organizationId}/${collection.slug}`,
        note: 'The collection page has a button to download it as a ZIP of its pricings.',
      };
    }

    default:
      return undefined;
  }
}

function requireOrganizationId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!mongoose.isValidObjectId(id)) throw new Error('NOT FOUND: Organization not found');
  return id;
}

/** The slug of a pricing named by its slug or its name; whether the user may see it is checked later. */
export async function resolvePricingSlug(organizationId: string, raw: unknown): Promise<string> {
  const name = typeof raw === 'string' ? raw.trim() : '';
  const repository: PricingRepository = container.resolve('pricingRepository');
  const match = name ? matchResource(await repository.findSummariesByOrganization(organizationId), name) : null;
  if (!match) throw new Error(`NOT FOUND: There is no pricing called "${name}" in this organization`);
  return match.slug;
}

async function resolveCollectionSlug(organizationId: string, raw: unknown): Promise<string> {
  const name = typeof raw === 'string' ? raw.trim() : '';
  const match = name
    ? matchResource(await container.resolve('pricingCollectionRepository').findSummariesByOrganization(organizationId), name)
    : null;
  if (!match) throw new Error(`NOT FOUND: There is no collection called "${name}" in this organization`);
  return (match as { slug: string }).slug;
}

/**
 * Parses one stored version. The text is read and parsed in memory: the
 * library's path reader may rewrite the file it is given, and a comparison must
 * never change a pricing.
 */
async function readVersion(organizationId: string, slug: string, visible: any, label: unknown): Promise<Pricing> {
  const wanted = String(label ?? '').trim().toLowerCase();
  if (!visible.versions.some((version: any) => String(version.version).toLowerCase() === wanted)) {
    throw new Error(`NOT FOUND: "${visible.name}" has no version "${label}"`);
  }
  const repository: PricingRepository = container.resolve('pricingRepository');
  const stored: any = await repository.findOne(slug, organizationId, { version: wanted, includePrivate: true });
  const file = stored?.versions?.[0]?.yaml;
  if (!file) throw new Error(`NOT FOUND: "${visible.name}" has no version "${label}"`);
  const absolute = path.resolve(process.env.SERVER_STATICS_FOLDER || 'public/', file);
  if (!fs.existsSync(absolute)) throw new Error(`NOT FOUND: The file of version "${label}" is missing`);
  return retrievePricingFromText(fs.readFileSync(absolute, 'utf8'));
}

/**
 * The pricings of a collection the user may see: all of them for its owners and
 * admins, otherwise the public ones and those they were given access to.
 */
async function visiblePricingsIn(organizationId: string, collection: { id: string; slug: string }, actor: OrbitActor) {
  const repository: PricingRepository = container.resolve('pricingRepository');
  const inCollection = (await repository.findSummariesByOrganization(organizationId)).filter(
    pricing => pricing.collectionId === collection.id
  );
  if (canManage(await resolveOrgRole(container.resolve('organizationService'), actor, organizationId))) return inCollection;
  const own = await container.resolve('entityPermissionRepository').findByUserAndOrganization(actor.id, organizationId);
  return inCollection.filter(
    pricing =>
      !pricing.private ||
      own.some((record: any) => record.permissions.GET && (
        (record.entityType === 'pricing' && record.entitySlug === pricing.slug) || (record.entityType === 'collection' && record.entitySlug === collection.slug)
      ))
  );
}

function summarizeAnalytics(analytics: any) {
  if (!analytics || typeof analytics !== 'object') return {};
  return {
    plans: analytics.numberOfPlans ?? null,
    addOns: analytics.numberOfAddOns ?? null,
    features: analytics.numberOfFeatures ?? null,
    usageLimits: analytics.numberOfUsageLimits ?? null,
    configurationSpaceSize: analytics.configurationSpaceSize ?? null,
    cheapestSubscription: analytics.minSubscriptionPrice ?? null,
    priciestSubscription: analytics.maxSubscriptionPrice ?? null,
  };
}
