import {
  PermissionContext,
  PermissionResult,
  BatchEvaluationContext,
  BatchEvaluationOptions,
} from '../types/policies';
import { allPolicies } from './policies';

/**
 * PermissionEngine - Centralized permission evaluation.
 *
 * This engine evaluates permission policies against a context.
 * Policies are evaluated in order; first applicable policy wins.
 *
 * Usage:
 *   const engine = new PermissionEngine();
 *   const result = engine.evaluate({
 *     userId: 'user1',
 *     organizationId: 'org1',
 *     entityType: 'pricing',
 *     entitySlug: 'pricing1',
 *     action: 'GET',
 *     isPrivate: true,
 *     userOrgRole: 'MEMBER',
 *     entityPermissions: { GET: true, PUT: false, DELETE: false, CREATE: false },
 *   });
 */
export class PermissionEngine {
  private policies = allPolicies;

  /**
   * Evaluate a single permission context.
   * Returns the result from the first applicable policy.
   * If no policy matches, access is denied by default.
   */
  evaluate(context: PermissionContext): PermissionResult {
    for (const policy of this.policies) {
      const result = policy.evaluate(context);
      if (result !== null) {
        return result;
      }
    }

    // Default deny
    return {
      allowed: false,
      reason: 'No matching policy found - access denied by default',
    };
  }

  /**
   * Evaluate multiple permission contexts in batch.
   * Uses a pre-fetched BatchEvaluationContext to avoid individual DB queries.
   *
   * @param contexts - Array of { key, context } pairs where key is used to identify the result
   * @param options - Optional pre-fetched batch context
   * @returns Map of key -> PermissionResult
   */
  evaluateBatch<K extends string>(
    contexts: { key: K; context: PermissionContext }[],
    options?: BatchEvaluationOptions
  ): Map<K, PermissionResult> {
    const results = new Map<K, PermissionResult>();

    for (const { key, context } of contexts) {
      // If batch context is provided, merge pre-fetched data into context
      const enrichedContext = options?.batchContext
        ? this.enrichContext(context, options.batchContext)
        : context;

      results.set(key, this.evaluate(enrichedContext));
    }

    return results;
  }

  /**
   * Enrich a context with pre-fetched batch data.
   */
  private enrichContext(
    context: PermissionContext,
    batchContext: BatchEvaluationContext
  ): PermissionContext {
    const enriched = { ...context };

    // Apply org-scoped permissions if not already set
    if (!enriched.orgPermissions && enriched.action === 'CREATE') {
      enriched.orgPermissions = batchContext.orgPermissions.get(enriched.entityType);
    }

    // Apply entity-level permissions if not already set
    if (!enriched.entityPermissions && enriched.entitySlug) {
      const key = `${enriched.entityType}:${enriched.entitySlug}`;
      enriched.entityPermissions = batchContext.entityPermissions.get(key);
    }

    // Apply collection permissions for pricing inheritance
    if (!enriched.collectionPermissions && enriched.collectionSlug) {
      enriched.collectionPermissions = batchContext.collectionPermissions.get(enriched.collectionSlug);
    }

    // Apply role info if not already set
    if (enriched.userOrgRole === undefined) {
      enriched.userOrgRole = batchContext.userOrgRole;
    }
    if (enriched.isGlobalAdmin === undefined) {
      enriched.isGlobalAdmin = batchContext.isGlobalAdmin;
    }

    return enriched;
  }
}
