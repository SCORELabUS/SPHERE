/**
 * Permission configuration for API routes
 * 
 * This file defines access control rules for both User API Keys and Organization API Keys.
 * 
 * Pattern matching:
 * - '*' matches any single path segment
 * - '**' matches any number of path segments (must be at the end)
 * 
 * Examples:
 * - '/users/*' matches '/users/john' but not '/users/john/profile'
 * - '/organizations/**' matches '/organizations/org1', '/organizations/org1/services', etc.
 */

import { RoutePermission } from "../types/permissions";

/**
 * Route permission configuration
 * 
 * Rules are evaluated in order. The first matching rule determines access.
 * If no rule matches, access is denied by default.
 */
export const ROUTE_PERMISSIONS: RoutePermission[] = [
  // ============================================
  // User Management Routes
  // ============================================
  {
    path: '/users/login',
    methods: ['POST'],
    isPublic: true,
  },
  // Login social (SSO UVUS, Google, …). Debe ir ANTES del catch-all /users/**:
  // las reglas se evalúan en orden y la primera que casa gana.
  {
    path: '/users/auth/sso/**',
    methods: ['GET'],
    isPublic: true,
  },
  {
    path: '/users/register',
    methods: ['POST'],
    isPublic: true,
  },
  {
    path: '/users/email-verification/verify',
    methods: ['POST'],
    isPublic: true,
  },
  {
    path: '/users/email-verification/resend',
    methods: ['POST'],
    isPublic: true,
  },
  {
    path: '/users/*/refresh-token',
    methods: ['PUT'],
    allowedUserRoles: ['ADMIN'],
  },
  // User pricing/collection access queries (before general /users/**)
  {
    path: '/users/*/pricings',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  {
    path: '/users/*/collections',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  // API Keys management
  {
    path: '/users/*/api-keys',
    methods: ['GET', 'POST'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  {
    path: '/users/*/api-keys/*',
    methods: ['DELETE'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  {
    path: '/users/*/api-keys/*/revoke',
    methods: ['PUT'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  // User settings: /users/me/settings (own settings)
  {
    path: '/users/me/settings/**',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  {
    path: '/users/**',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },

  // ============================================
  // Pricing Management Routes 
  // ============================================

  {
    path: '/pricings',
    methods: ['GET', 'PUT'], // Also allow updating pricings through /pricings endpoint for simplicity
    isPublic: true, // Allow public access to list pricings
  },
  // Pricing entity permissions (before general /pricings/** for GET)
  {
    path: '/pricings/*/*/permissions',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  {
    path: '/pricings/**',
    methods: ['GET'],
    isPublic: true,
  },
  {
    path: '/pricings/**',
    methods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },

  // ============================================
  // Collection Management Routes 
  // ============================================

  // Collection entity permissions
  {
    path: '/collections/*/*/permissions',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  {
    path: '/collections/**',
    methods: ['GET'],
    isPublic: true, // Allow public access to view collections
  },
  {
    path: '/collections/**',
    methods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },

  // ============================================
  // Organizations and Groups Routes
  // ============================================
  {
    path: '/orgs/invitations/preview/*',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  {
    path: '/orgs/join/*',
    methods: ['POST'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  // Get current user's organizations: no org-context required.
  {
    path: '/users/me/orgs',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  // Org creation/listing: no org-context required.
  {
    path: '/orgs/public',
    methods: ['GET'],
    isPublic: true,
  },
  {
    path: '/orgs',
    methods: ['GET', 'POST'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },
  // Public org read access (unauthenticated users can view org details and members).
  {
    path: '/orgs/*/members',
    methods: ['GET'],
    isPublic: true,
  },
  {
    path: '/orgs/*/members',
    methods: ['POST', 'PUT'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN'],
  },
  {
    path: '/orgs/*',
    methods: ['GET'],
    isPublic: true,
  },
  // Entity permission management is OWNER/ADMIN.
  {
    path: '/orgs/*/permissions',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN', 'MEMBER'],
  },
  {
    path: '/orgs/*/permissions',
    methods: ['POST'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN'],
  },
  {
    path: '/orgs/*/permissions/**',
    methods: ['DELETE'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN'],
  },
  // Everything under /orgs/:organizationId/** requires membership context.
  // Global ADMIN bypasses membership checks.
  {
    path: '/orgs/**',
    methods: ['GET'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN', 'MEMBER'],
  },
  {
    path: '/orgs/**',
    methods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN'],
  },
  // Only OWNER/ADMIN can manage org members.
  {
    path: '/orgs/*/members/**',
    methods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN'],
  },
  // Invitations management is OWNER/ADMIN.
  {
    path: '/orgs/*/invitations/**',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedUserRoles: ['ADMIN', 'USER'],
    allowedOrganizationRoles: ['OWNER', 'ADMIN'],
  },

  // ============================================
  // Notification Routes
  // ============================================
  // SSE stream endpoint: EventSource cannot set headers, so the token is passed
  // as a query parameter. The controller handles its own authentication.
  {
    path: '/notifications/stream',
    methods: ['GET'],
    isPublic: true,
  },
  {
    path: '/notifications/**',
    methods: ['GET', 'PUT', 'DELETE'],
    allowedUserRoles: ['ADMIN', 'USER'],
  },

  // ============================================
  // Health Check (Public)
  // ============================================
  {
    path: '/healthcheck',
    methods: ['GET'],
    isPublic: true, // No authentication required
  },

  // ============================================
  // Cache Management Routes
  // ============================================
  {
    path: '/cache/**',
    methods: ['GET', 'POST'],
    isPublic: true,
  },
];

/**
 * Default denial message when no permission is granted
 */
export const DEFAULT_PERMISSION_DENIED_MESSAGE = 'You do not have permission to access this resource';
