import { useCallback } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';

const BASE_PATH = import.meta.env.VITE_API_URL;

/** AUTONOMOUS and DEPENDENT are known; any other text is a kind the organization made up. */
export type ServiceKind = 'AUTONOMOUS' | 'DEPENDENT' | (string & {});
/** FUNCTIONAL and ACCOUNT are known; any other text is kept as written. */
export type ServiceDependency = 'FUNCTIONAL' | 'ACCOUNT' | (string & {});

/** The known channels, in capitals; any other text is a channel the organization made up. */
export type InterfaceChannel =
  'INTERACTIVE' | 'PROGRAMMATIC' | 'CONVERSATIONAL' | 'AGENTIC' | 'EVENT' | (string & {});

/** A way of using a service. Fields other than the named ones (a quote, its source...) are kept as given. */
export interface ServiceInterface {
  name: string;
  channel: InterfaceChannel | null;
  pending: boolean;
  description: string;
  mechanisms: string[];
  [field: string]: unknown;
}

/** A page about the service's terms (refunds, SLA...). Fields other than the named ones are kept as given. */
export interface ServiceLink {
  url: string;
  title: string;
  /** What it is about, free text (e.g. "Refunds"). */
  topic: string | null;
  /** The question it answers, or what it says. */
  description: string;
  [field: string]: unknown;
}

export interface ServiceNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  /** Null while the service is not classified. */
  kind: ServiceKind | null;
  dependency: ServiceDependency | null;
  pricingIds: string[];
  /** Free fields (e.g. customers), edited in the JSON view and kept as given. */
  attributes: Record<string, unknown>;
  /** The ways the service is used (web app, API, bot...), grouped by channel when shown. */
  interfaces: ServiceInterface[];
  /** Pages answering questions about the service's terms. */
  links: ServiceLink[];
}

export interface ServiceTreePricing {
  pricingId: string;
  name: string;
  slug: string;
  version: string;
  private: boolean;
  collection: { id: string; name: string; slug: string } | null;
  plans: number | null;
  addOns: number | null;
}

export interface ServiceTreeView {
  nodes: ServiceNode[];
  revision: number;
  updatedAt: string | null;
  /** Linked pricings the user may see; a pricingId missing here is hidden from them. */
  pricings: Record<string, ServiceTreePricing>;
  canEdit: boolean;
}

/** Thrown when the tree was saved by someone else since it was loaded. */
export class ServiceTreeConflictError extends Error {}

/** Every node with its attributes, so trees from before they existed compare equal to their edits. */
function normalize(view: ServiceTreeView): ServiceTreeView {
  return {
    ...view,
    nodes: view.nodes.map(node => ({
      ...node,
      attributes: node.attributes ?? {},
      interfaces: node.interfaces ?? [],
      links: node.links ?? [],
    })),
  };
}

export function useServiceTreeApi() {
  const { fetchWithInterceptor } = useAuth();

  const getServiceTree = useCallback(
    async (organizationId: string): Promise<ServiceTreeView> => {
      const res = await fetchWithInterceptor(`${BASE_PATH}/orgs/${organizationId}/services`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load the services');
      }
      return normalize(await res.json());
    },
    [fetchWithInterceptor]
  );

  const saveServiceTree = useCallback(
    async (
      organizationId: string,
      nodes: ServiceNode[],
      revision: number
    ): Promise<ServiceTreeView> => {
      const res = await fetchWithInterceptor(`${BASE_PATH}/orgs/${organizationId}/services`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, revision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.error || 'Failed to save the services';
        throw res.status === 409 ? new ServiceTreeConflictError(message) : new Error(message);
      }
      return normalize(await res.json());
    },
    [fetchWithInterceptor]
  );

  return { getServiceTree, saveServiceTree };
}
