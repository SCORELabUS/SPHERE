/**
 * AUTONOMOUS and DEPENDENT are the kinds the UI knows; any other text is a kind
 * the organization made up (e.g. "Add-on"), kept as written.
 */
export type ServiceKind = 'AUTONOMOUS' | 'DEPENDENT' | (string & {});
/** FUNCTIONAL and ACCOUNT are known; any other text is kept as written. */
export type ServiceDependency = 'FUNCTIONAL' | 'ACCOUNT' | (string & {});

/**
 * The channels the UI knows; any other text is a channel the organization made
 * up, kept as written, so the taxonomy can grow without code changes.
 */
export type InterfaceChannel = 'INTERACTIVE' | 'PROGRAMMATIC' | 'CONVERSATIONAL' | 'AGENTIC' | 'EVENT' | (string & {});

/**
 * A way of using a service (its web app, its REST API, a chat bot...). The named
 * fields are the ones the UI shows; any other field is kept as given, in order.
 */
export interface ServiceInterface {
  name: string;
  /** Null while not classified. */
  channel: InterfaceChannel | null;
  /** Found but not confirmed yet. */
  pending: boolean;
  description: string;
  /** How it is reached: clients, commands, protocols... */
  mechanisms: string[];
  [field: string]: unknown;
}

export interface ServiceNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  /** Null while the service is not classified yet. */
  kind: ServiceKind | null;
  /** What the service depends on, if anything. */
  dependency: ServiceDependency | null;
  /** Pricing identities (`pricingId`) of the organization linked to the service. */
  pricingIds: string[];
  /**
   * Free fields of the service (e.g. its customers), kept as given. New kinds of
   * data can be stored here before they get a field of their own.
   */
  attributes: Record<string, unknown>;
  /** The ways the service is used, in the order given. */
  interfaces: ServiceInterface[];
}

export interface ServiceTree {
  nodes: ServiceNode[];
  revision: number;
  updatedAt: Date | null;
}

/** What the caller sees of a linked pricing: only pricings they may list. */
export interface ServiceTreePricing {
  pricingId: string;
  name: string;
  slug: string;
  version: string;
  private: boolean;
  collection: { id: string; name: string; slug: string } | null;
  /** Plans and add-ons of the version listed, when its analytics are known. */
  plans: number | null;
  addOns: number | null;
}

export interface ServiceTreeView extends ServiceTree {
  /** Linked pricings the caller may see, by pricingId; the others are left out. */
  pricings: Record<string, ServiceTreePricing>;
  canEdit: boolean;
}
