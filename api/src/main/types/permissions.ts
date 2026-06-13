import { OrgRole } from "./models/Organization";

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type UserRole = 'ADMIN' | 'USER';
export type OrganizationApiKeyRole = 'ALL' | 'MANAGEMENT' | 'EVALUATION';

export interface RoutePermission {
  path: string;
  methods: HttpMethod[];
  allowedUserRoles?: UserRole[];
  allowedOrgRoles?: OrganizationApiKeyRole[];
  /**
   * Organization membership role(s) required to access this route.
   * If set, the request must carry an organization context (path takes precedence over header)
   * and the authenticated user must belong to that organization (ADMIN bypasses).
   */
  allowedOrganizationRoles?: OrgRole[];
  requiresUser?: boolean; // If true, only user API keys are allowed (not org keys)
  isPublic?: boolean; // If true, no authentication required
}

export const USER_ROLES: UserRole[] = ['ADMIN', 'USER'];
