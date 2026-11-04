import container from '../config/container';
import ServiceTreeRepository from '../repositories/mongoose/ServiceTreeRepository';
import { LeanUser } from '../types/models/User';
import { OrgRole } from '../types/models/Organization';
import {
  ServiceDependency,
  ServiceKind,
  ServiceNode,
  ServiceTree,
  ServiceTreePricing,
  ServiceTreeView,
} from '../types/models/ServiceTree';
import PricingService from './PricingService';

export const SERVICE_TREE_LIMITS = {
  nodes: 500,
  depth: 12,
  nameLength: 120,
  descriptionLength: 1000,
  labelLength: 40,
  pricingsPerNode: 50,
  attributes: 30,
  attributesLength: 4000,
  attributesDepth: 5,
};

/**
 * Names a free attribute cannot take: the fields of a service, and the names
 * the JSON editor uses for them, so a service written as JSON reads back the same.
 */
export const RESERVED_ATTRIBUTES = ['id', 'parentId', 'name', 'description', 'kind', 'dependency', 'pricingIds', 'pricings', 'services', 'attributes'];
const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const KINDS: ServiceKind[] = ['AUTONOMOUS', 'DEPENDENT'];
const DEPENDENCIES: ServiceDependency[] = ['FUNCTIONAL', 'ACCOUNT'];

/**
 * A kind or dependency: free text, so organizations can name new ones, with the
 * known values written the same way whatever their case. Empty means none.
 */
function parseLabel<T extends string>(raw: unknown, known: T[], what: string): T | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw.trim().length > SERVICE_TREE_LIMITS.labelLength) {
    throw new Error(`INVALID DATA: ${what} must be text of at most ${SERVICE_TREE_LIMITS.labelLength} characters`);
  }
  const label = raw.trim();
  if (!label) return null;
  return known.find(value => value === label.toUpperCase()) ?? (label as T);
}
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Who may change an organization's tree: its OWNER and ADMIN members. */
export function canEditServiceTree(orgRole: OrgRole | null | undefined): boolean {
  return orgRole === 'OWNER' || orgRole === 'ADMIN';
}

/**
 * The tree of services of an organization (beta). Members read it and its
 * OWNER/ADMIN replace it whole, so an edit session saves in one go. Pricings
 * are linked by pricing identity and shown only to who may list them.
 */
class ServiceTreeService {
  private serviceTreeRepository: ServiceTreeRepository;
  private pricingService: PricingService;

  constructor() {
    this.serviceTreeRepository = container.resolve('serviceTreeRepository');
    this.pricingService = container.resolve('pricingService');
  }

  async show(organizationId: string, reqUser: LeanUser & { orgRole?: OrgRole | null }): Promise<ServiceTreeView> {
    const tree = await this.serviceTreeRepository.findByOrganizationId(organizationId);
    return this.view(organizationId, tree, reqUser);
  }

  async replace(
    organizationId: string,
    body: unknown,
    reqUser: LeanUser & { orgRole?: OrgRole | null }
  ): Promise<ServiceTreeView> {
    if (!canEditServiceTree(reqUser.orgRole)) {
      throw new Error('PERMISSION ERROR: Only owners and admins can edit the services');
    }
    const { nodes, revision } = this.parse(body);

    const linked = [...new Set(nodes.flatMap(node => node.pricingIds))];
    const existing = await this.serviceTreeRepository.findOrganizationPricingIds(organizationId, linked);
    const foreign = linked.filter(id => !existing.has(id));
    if (foreign.length) {
      throw new Error(`INVALID DATA: These pricings do not belong to the organization: ${foreign.join(', ')}`);
    }

    const saved = await this.serviceTreeRepository.replace(organizationId, nodes, revision, reqUser.id);
    if (!saved) {
      throw new Error('CONFLICT: The services were changed by someone else. Reload them and apply your changes again');
    }
    return this.view(organizationId, saved, reqUser);
  }

  private async view(
    organizationId: string,
    tree: ServiceTree,
    reqUser: LeanUser & { orgRole?: OrgRole | null }
  ): Promise<ServiceTreeView> {
    const linked = new Set(tree.nodes.flatMap(node => node.pricingIds));
    const pricings: Record<string, ServiceTreePricing> = {};
    if (linked.size) {
      // The organization's listing applies the caller's permissions, so a pricing
      // they may not see is left out instead of having its name revealed.
      const listing: any = await this.pricingService.indexByOrganizationId(organizationId, reqUser, {
        limit: 10000,
        offset: 0,
      });
      for (const pricing of listing?.pricings ?? []) {
        if (!pricing.pricingId || !linked.has(pricing.pricingId)) continue;
        pricings[pricing.pricingId] = {
          pricingId: pricing.pricingId,
          name: pricing.name,
          slug: pricing.slug,
          version: pricing.version,
          private: pricing.private === true,
          collection: pricing.collection?.slug
            ? { id: pricing.collection.id, name: pricing.collection.name, slug: pricing.collection.slug }
            : null,
        };
      }
    }
    return { ...tree, pricings, canEdit: canEditServiceTree(reqUser.orgRole) };
  }

  private parse(body: unknown): { nodes: ServiceNode[]; revision: number } {
    const input = body as { nodes?: unknown; revision?: unknown } | null;
    if (!input || typeof input !== 'object') throw new Error('INVALID DATA: The body must be an object');
    const { revision } = input;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
      throw new Error('INVALID DATA: revision must be the revision the changes are based on');
    }
    if (!Array.isArray(input.nodes)) throw new Error('INVALID DATA: nodes must be an array');
    if (input.nodes.length > SERVICE_TREE_LIMITS.nodes) {
      throw new Error(`INVALID DATA: A tree holds at most ${SERVICE_TREE_LIMITS.nodes} services`);
    }

    const nodes = input.nodes.map((raw, index) => this.parseNode(raw, index));

    const ids = new Set<string>();
    for (const node of nodes) {
      if (ids.has(node.id)) throw new Error(`INVALID DATA: Two services share the id ${node.id}`);
      ids.add(node.id);
    }
    const parentOf = new Map(nodes.map(node => [node.id, node.parentId]));
    for (const node of nodes) {
      if (node.parentId !== null && !ids.has(node.parentId)) {
        throw new Error(`INVALID DATA: The parent of service ${node.id} is missing from the tree`);
      }
      // Walking up from every node finds cycles and measures its depth; the depth
      // limit also ends the walk from a node that hangs from someone else's cycle.
      let depth = 1;
      for (let current = node.parentId; current !== null; current = parentOf.get(current) ?? null) {
        if (current === node.id) throw new Error(`INVALID DATA: Service ${node.id} is inside itself`);
        depth += 1;
        if (depth > SERVICE_TREE_LIMITS.depth) {
          throw new Error(`INVALID DATA: Services can be nested at most ${SERVICE_TREE_LIMITS.depth} levels deep`);
        }
      }
    }
    return { nodes, revision };
  }

  private parseNode(raw: unknown, index: number): ServiceNode {
    const where = `service #${index + 1}`;
    const node = raw as Record<string, unknown> | null;
    if (!node || typeof node !== 'object') throw new Error(`INVALID DATA: ${where} must be an object`);

    if (typeof node.id !== 'string' || !NODE_ID.test(node.id)) {
      throw new Error(`INVALID DATA: ${where} needs an id of letters, digits, - or _ (at most 64)`);
    }
    if (node.parentId !== null && node.parentId !== undefined && typeof node.parentId !== 'string') {
      throw new Error(`INVALID DATA: The parentId of ${where} must be a service id or null`);
    }
    const name = typeof node.name === 'string' ? node.name.trim() : '';
    if (!name || name.length > SERVICE_TREE_LIMITS.nameLength) {
      throw new Error(`INVALID DATA: ${where} needs a name of 1 to ${SERVICE_TREE_LIMITS.nameLength} characters`);
    }
    const description = node.description === undefined || node.description === null ? '' : node.description;
    if (typeof description !== 'string' || description.length > SERVICE_TREE_LIMITS.descriptionLength) {
      throw new Error(`INVALID DATA: The description of ${where} must be text of at most ${SERVICE_TREE_LIMITS.descriptionLength} characters`);
    }
    const kind = parseLabel(node.kind, KINDS, `The kind of ${where}`);
    const dependency = parseLabel(node.dependency, DEPENDENCIES, `The dependency of ${where}`);
    const pricingIds = node.pricingIds === undefined ? [] : node.pricingIds;
    if (!Array.isArray(pricingIds) || pricingIds.some(id => typeof id !== 'string')) {
      throw new Error(`INVALID DATA: The pricingIds of ${where} must be a list of pricing ids`);
    }
    const uniquePricingIds = [...new Set(pricingIds as string[])];
    if (uniquePricingIds.length > SERVICE_TREE_LIMITS.pricingsPerNode) {
      throw new Error(`INVALID DATA: A service links at most ${SERVICE_TREE_LIMITS.pricingsPerNode} pricings`);
    }

    const attributes = this.parseAttributes(node.attributes, where);

    return {
      id: node.id,
      parentId: (node.parentId as string | null | undefined) ?? null,
      name,
      description: description.trim(),
      kind,
      dependency,
      pricingIds: uniquePricingIds,
      attributes,
    };
  }

  private parseAttributes(raw: unknown, where: string): Record<string, unknown> {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`INVALID DATA: The attributes of ${where} must be an object`);
    const names = Object.keys(raw);
    if (names.length > SERVICE_TREE_LIMITS.attributes) {
      throw new Error(`INVALID DATA: ${where} has more than ${SERVICE_TREE_LIMITS.attributes} attributes`);
    }
    for (const name of names) {
      if (!ATTRIBUTE_NAME.test(name) || RESERVED_ATTRIBUTES.includes(name)) {
        throw new Error(
          `INVALID DATA: "${name}" cannot name an attribute of ${where}: use a letter followed by letters, digits, - or _, and none of ${RESERVED_ATTRIBUTES.join(', ')}`
        );
      }
    }
    if (JSON.stringify(raw).length > SERVICE_TREE_LIMITS.attributesLength) {
      throw new Error(`INVALID DATA: The attributes of ${where} take more than ${SERVICE_TREE_LIMITS.attributesLength} characters`);
    }
    // Nested keys are stored as they come, so they must be valid MongoDB field names.
    const check = (value: unknown, depth: number): void => {
      if (value === null || typeof value !== 'object') return;
      if (depth > SERVICE_TREE_LIMITS.attributesDepth) {
        throw new Error(`INVALID DATA: The attributes of ${where} are nested more than ${SERVICE_TREE_LIMITS.attributesDepth} levels`);
      }
      if (Array.isArray(value)) return value.forEach(item => check(item, depth + 1));
      for (const [key, item] of Object.entries(value)) {
        if (key.startsWith('$') || key.includes('.') || !key) {
          throw new Error(`INVALID DATA: "${key}" in the attributes of ${where} cannot start with $ or contain a dot`);
        }
        check(item, depth + 1);
      }
    };
    check(raw, 1);
    return raw as Record<string, unknown>;
  }
}

export default ServiceTreeService;
