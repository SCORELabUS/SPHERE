/**
 * Centralized configuration for authentication middleware tests
 * Maps all API endpoints to their HTTP methods and allowed roles
 *
 * This config makes it easy to:
 * - Add new endpoints
 * - Update role permissions
 * - Generate comprehensive test suites
 * - Ensure consistency across unit and integration tests
 */

import { ROUTE_PERMISSIONS } from "../../../main/config/permissions";
import { HttpMethod, RoutePermission } from "../../../main/types/permissions";

export interface EndpointConfig {
  path: string;
  methods: HttpMethod[];
  isPublic: boolean;
  allowedUserRoles?: string[];
  allowedOrganizationRoles?: string[];
  requiresOrgContext?: boolean;
}

/**
 * Authentication types
 */
export const AUTH_TYPES = {
  BEARER_TOKEN: 'token',
  API_KEY: 'api-key',
};

/**
 * Filters endpoints by criteria
 */
export function filterEndpoints(
  criteria: {
    isPublic?: boolean;
    methods?: HttpMethod[];
    requiresOrgContext?: boolean;
  }
): RoutePermission[] {
  return ROUTE_PERMISSIONS.filter((endpoint) => {
    const endpointIsPublic = endpoint.isPublic ?? false;

    if (criteria.isPublic !== undefined && endpointIsPublic !== criteria.isPublic) {
      return false;
    }
    if (criteria.methods && !criteria.methods.some((m) => endpoint.methods.includes(m))) {
      return false;
    }
    if (criteria.requiresOrgContext !== undefined && criteria.requiresOrgContext && (!endpoint.allowedOrganizationRoles || endpoint.allowedOrganizationRoles.length === 0)) {
      return false;
    }
    return true;
  });
}

/**
 * Gets all protected endpoints
 */
export function getProtectedEndpoints(): RoutePermission[] {
  return filterEndpoints({ isPublic: false });
}

/**
 * Gets all public endpoints (middleware-level).
 *
 * /notifications/stream is excluded: it is marked public only so the
 * middleware lets the request through — the SSE EventSource API cannot
 * set Authorization headers. The controller authenticates via a
 * query-parameter token and returns 401 when the token is missing,
 * which is expected behaviour.
 */
export function getPublicEndpoints(): RoutePermission[] {
  return filterEndpoints({ isPublic: true }).filter(
    (ep) => ep.path !== '/notifications/stream'
  );
}

/**
 * Gets all org-context-required endpoints
 */
export function getOrgContextEndpoints(): RoutePermission[] {
  return filterEndpoints({ requiresOrgContext: true });
}
