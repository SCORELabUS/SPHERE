import { EntityType, EntityPermissions, PermissionType } from './models/EntityPermission';
import { OrgRole } from './models/Organization';

/**
 * Context for a single permission evaluation.
 * Contains all the information needed to evaluate policies.
 */
export interface PermissionContext {
  /** User ID requesting access */
  userId: string;
  /** Organization context */
  organizationId: string;
  /** Entity type being accessed */
  entityType: EntityType;
  /** Specific entity ID (undefined for org-scoped operations like CREATE) */
  entityId?: string;
  /** Action being performed */
  action: PermissionType;
  /** Whether the entity is private (affects GET checks) */
  isPrivate?: boolean;
  /** User's role in the organization */
  userOrgRole?: OrgRole | null;
  /** Whether the user is a global SPHERE ADMIN */
  isGlobalAdmin?: boolean;
  /** Collection ID for inheritance checks (pricing inside collection) */
  collectionId?: string;
  /** Pre-fetched org-scoped permissions (for CREATE checks) */
  orgPermissions?: EntityPermissions;
  /** Pre-fetched entity-level permissions */
  entityPermissions?: EntityPermissions;
  /** Pre-fetched collection permissions (for pricing inheritance) */
  collectionPermissions?: EntityPermissions;
}

/**
 * Result of a permission evaluation.
 */
export interface PermissionResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason?: string;
}

/**
 * A policy function that evaluates a permission context.
 */
export type PolicyFunction = (context: PermissionContext) => PermissionResult | null;

/**
 * Named policy with a function and description.
 */
export interface Policy {
  /** Unique policy name */
  name: string;
  /** Human-readable description */
  description: string;
  /** The policy evaluation function */
  evaluate: PolicyFunction;
}

/**
 * Batch evaluation context with pre-fetched data.
 */
export interface BatchEvaluationContext {
  userId: string;
  organizationId: string;
  userOrgRole?: OrgRole | null;
  isGlobalAdmin?: boolean;
  /** Pre-fetched org-scoped permissions keyed by entityType */
  orgPermissions: Map<string, EntityPermissions>;
  /** Pre-fetched entity permissions keyed by "entityType:entityId" */
  entityPermissions: Map<string, EntityPermissions>;
  /** Pre-fetched collection permissions for pricing inheritance */
  collectionPermissions: Map<string, EntityPermissions>;
}

/**
 * Options for batch evaluation.
 */
export interface BatchEvaluationOptions {
  /** Pre-fetched batch context (avoids individual DB queries) */
  batchContext?: BatchEvaluationContext;
}

export interface OrgUserPermissionsContext {
  orgRole: OrgRole | null;
  pricings: string[];
  collections: string[];
}
