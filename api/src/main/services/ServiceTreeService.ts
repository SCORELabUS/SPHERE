import container from '../config/container';
import ServiceTreeRepository from '../repositories/mongoose/ServiceTreeRepository';
import { LeanUser } from '../types/models/User';
import { OrgRole } from '../types/models/Organization';
import {
  InterfaceChannel,
  ServiceDependency,
  ServiceInterface,
  ServiceLink,
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
  interfacesPerNode: 100,
  interfaceNameLength: 200,
  interfaceDescriptionLength: 2000,
  mechanisms: 20,
  mechanismLength: 120,
  interfaceLength: 4000,
  linksPerNode: 50,
  urlLength: 2000,
  linkTitleLength: 200,
  linkDescriptionLength: 1000,
  linkLength: 4000,
};

/**
 * Names a free attribute cannot take: the fields of a service, and the names
 * the JSON editor uses for them, so a service written as JSON reads back the same.
 */
export const RESERVED_ATTRIBUTES = [
  'id',
  'parentId',
  'name',
  'description',
  'kind',
  'dependency',
  'pricingIds',
  'pricings',
  'services',
  'attributes',
  'interfaces',
  'links',
];
/** The fields of an interface; any other name is a free field of it. */
const INTERFACE_FIELDS = ['name', 'channel', 'pending', 'description', 'mechanisms'];
/** The fields of a link; any other name is a free field of it. */
const LINK_FIELDS = ['url', 'title', 'topic', 'description'];
const CHANNELS: InterfaceChannel[] = ['INTERACTIVE', 'PROGRAMMATIC', 'CONVERSATIONAL', 'AGENTIC', 'EVENT'];
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

/** An absolute http(s) address, the only kind shown as a link (never javascript: or data:). */
function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

/**
 * Free values are stored as they come, so their keys must be valid MongoDB field
 * names, and they may not be nested without end.
 */
function assertStorable(value: unknown, what: string, depth = 1): void {
  if (value === null || typeof value !== 'object') return;
  if (depth > SERVICE_TREE_LIMITS.attributesDepth) {
    throw new Error(`INVALID DATA: ${what} are nested more than ${SERVICE_TREE_LIMITS.attributesDepth} levels`);
  }
  if (Array.isArray(value)) return value.forEach(item => assertStorable(item, what, depth + 1));
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.') || !key) {
      throw new Error(`INVALID DATA: "${key}" in ${what} cannot start with $ or contain a dot`);
    }
    assertStorable(item, what, depth + 1);
  }
}

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
          plans: typeof pricing.analytics?.numberOfPlans === 'number' ? pricing.analytics.numberOfPlans : null,
          addOns: typeof pricing.analytics?.numberOfAddOns === 'number' ? pricing.analytics.numberOfAddOns : null,
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
    const interfaces = this.parseInterfaces(node.interfaces, where);
    const links = this.parseLinks(node.links, where);

    return {
      id: node.id,
      parentId: (node.parentId as string | null | undefined) ?? null,
      name,
      description: description.trim(),
      kind,
      dependency,
      pricingIds: uniquePricingIds,
      attributes,
      interfaces,
      links,
    };
  }

  /**
   * The links of a service, written in one order (named fields first) so equal
   * lists compare equal. Only http(s) addresses are taken, since they are shown as links.
   */
  private parseLinks(raw: unknown, where: string): ServiceLink[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new Error(`INVALID DATA: The links of ${where} must be a list`);
    if (raw.length > SERVICE_TREE_LIMITS.linksPerNode) {
      throw new Error(`INVALID DATA: A service has at most ${SERVICE_TREE_LIMITS.linksPerNode} links`);
    }
    return raw.map((item, index) => {
      const what = `link #${index + 1} of ${where}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`INVALID DATA: ${what} must be an object`);
      const entry = item as Record<string, unknown>;
      const url = typeof entry.url === 'string' ? entry.url.trim() : '';
      if (!isWebAddress(url) || url.length > SERVICE_TREE_LIMITS.urlLength) {
        throw new Error(`INVALID DATA: ${what} needs a url starting with http:// or https:// (at most ${SERVICE_TREE_LIMITS.urlLength} characters)`);
      }
      const title = entry.title ?? '';
      if (typeof title !== 'string' || title.length > SERVICE_TREE_LIMITS.linkTitleLength) {
        throw new Error(`INVALID DATA: The title of ${what} must be text of at most ${SERVICE_TREE_LIMITS.linkTitleLength} characters`);
      }
      const topic = parseLabel(entry.topic, [], `The topic of ${what}`);
      const description = entry.description ?? '';
      if (typeof description !== 'string' || description.length > SERVICE_TREE_LIMITS.linkDescriptionLength) {
        throw new Error(`INVALID DATA: The description of ${what} must be text of at most ${SERVICE_TREE_LIMITS.linkDescriptionLength} characters`);
      }
      const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !LINK_FIELDS.includes(key)));
      for (const key of Object.keys(extra)) {
        if (!ATTRIBUTE_NAME.test(key)) {
          throw new Error(`INVALID DATA: "${key}" cannot name a field of ${what}: use a letter followed by letters, digits, - or _`);
        }
      }
      assertStorable(extra, `the fields of ${what}`);
      const parsed: ServiceLink = { url, title: title.trim(), topic, description: description.trim(), ...extra };
      if (JSON.stringify(parsed).length > SERVICE_TREE_LIMITS.linkLength) {
        throw new Error(`INVALID DATA: ${what} takes more than ${SERVICE_TREE_LIMITS.linkLength} characters`);
      }
      return parsed;
    });
  }

  /** The interfaces of a service, written in one order (named fields first) so equal lists compare equal. */
  private parseInterfaces(raw: unknown, where: string): ServiceInterface[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new Error(`INVALID DATA: The interfaces of ${where} must be a list`);
    if (raw.length > SERVICE_TREE_LIMITS.interfacesPerNode) {
      throw new Error(`INVALID DATA: A service has at most ${SERVICE_TREE_LIMITS.interfacesPerNode} interfaces`);
    }
    return raw.map((item, index) => {
      const what = `interface #${index + 1} of ${where}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`INVALID DATA: ${what} must be an object`);
      const entry = item as Record<string, unknown>;
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name || name.length > SERVICE_TREE_LIMITS.interfaceNameLength) {
        throw new Error(`INVALID DATA: ${what} needs a name of 1 to ${SERVICE_TREE_LIMITS.interfaceNameLength} characters`);
      }
      const channel = parseLabel(entry.channel, CHANNELS, `The channel of ${what}`);
      if (entry.pending !== undefined && entry.pending !== null && typeof entry.pending !== 'boolean') {
        throw new Error(`INVALID DATA: pending in ${what} must be true or false`);
      }
      const description = entry.description ?? '';
      if (typeof description !== 'string' || description.length > SERVICE_TREE_LIMITS.interfaceDescriptionLength) {
        throw new Error(`INVALID DATA: The description of ${what} must be text of at most ${SERVICE_TREE_LIMITS.interfaceDescriptionLength} characters`);
      }
      const mechanisms = entry.mechanisms ?? [];
      if (
        !Array.isArray(mechanisms) ||
        mechanisms.length > SERVICE_TREE_LIMITS.mechanisms ||
        mechanisms.some(m => typeof m !== 'string' || !m.trim() || m.length > SERVICE_TREE_LIMITS.mechanismLength)
      ) {
        throw new Error(
          `INVALID DATA: The mechanisms of ${what} must be a list of at most ${SERVICE_TREE_LIMITS.mechanisms} texts of up to ${SERVICE_TREE_LIMITS.mechanismLength} characters`
        );
      }
      const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !INTERFACE_FIELDS.includes(key)));
      for (const key of Object.keys(extra)) {
        if (!ATTRIBUTE_NAME.test(key)) {
          throw new Error(`INVALID DATA: "${key}" cannot name a field of ${what}: use a letter followed by letters, digits, - or _`);
        }
      }
      assertStorable(extra, `the fields of ${what}`);
      const parsed: ServiceInterface = {
        name,
        channel,
        pending: entry.pending === true,
        description: description.trim(),
        mechanisms: (mechanisms as string[]).map(m => m.trim()),
        ...extra,
      };
      if (JSON.stringify(parsed).length > SERVICE_TREE_LIMITS.interfaceLength) {
        throw new Error(`INVALID DATA: ${what} takes more than ${SERVICE_TREE_LIMITS.interfaceLength} characters`);
      }
      return parsed;
    });
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
    assertStorable(raw, `the attributes of ${where}`);
    return raw as Record<string, unknown>;
  }
}

export default ServiceTreeService;
