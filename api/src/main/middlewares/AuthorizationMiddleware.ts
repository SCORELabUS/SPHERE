import { Request, Response, NextFunction } from 'express';
import container from '../config/container';
import { HttpMethod } from '../types/permissions';
import { extractApiPath, matchPath } from '../utils/routeMatcher';
import { DEFAULT_PERMISSION_DENIED_MESSAGE, ROUTE_PERMISSIONS } from '../config/permissions';
import { handleError } from '../utils/users/helpers';
import { ApiKey } from '../types/models/User';
import { ROLE_WEIGHT } from '../types/models/Organization';
import { EntityType, PermissionType } from '../types/models/EntityPermission';
import { PermissionEngine } from '../policies/PermissionEngine';
import { extractOrganizationIdFromPath } from './AuthenticationMiddleware';

/**
 * Authorization middleware.
 * Checks route permissions, user/org roles, and entity-level permissions.
 * Must run AFTER authenticationMiddleware.
 */
const authorizationMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const method = req.method.toUpperCase() as HttpMethod;
    const baseUrlPath = (process.env.BASE_URL_PATH ?? '') + '/api/v1';
    const apiPath = extractApiPath(req.path, baseUrlPath);

    const matchingRule = ROUTE_PERMISSIONS.find(rule => {
      if (!rule.methods.includes(method)) {
        return false;
      }
      const methodMatches = rule.methods.includes(method);
      const pathMatches = matchPath(rule.path, apiPath);
      return methodMatches && pathMatches;
    });

    if (!matchingRule) {
      return res.status(403).json({
        error: DEFAULT_PERMISSION_DENIED_MESSAGE,
        details: `No permission rule found for ${method} ${apiPath}`,
      });
    }

    if (matchingRule.isPublic) {
      return next();
    }

    if (!(req as any).user) {
      return res.status(401).json({
        error:
          'INVALID DATA: Token not found. Please ensure to add a token as value of the "Authorization" header, using `Bearer {token}` format.',
      });
    }

    await populateOrganizationContext(req);

    if (
      !matchingRule.allowedUserRoles ||
      !matchingRule.allowedUserRoles.includes((req as any).user.role)
    ) {
      return res.status(403).json({
        error: `PERMISSION ERROR: Your user role (${(req as any).user.role}) does not have permission to ${method} ${apiPath}`,
      });
    }

    if (matchingRule.allowedOrganizationRoles?.length) {
      const user = (req as any).user;
      const org = (req as any).org;
      const organizationId = req.params.organizationId || extractOrganizationIdFromPath(apiPath);

      if (organizationId && !req.params.organizationId) {
        req.params.organizationId = organizationId;
      }

      if (!org) {
        return res.status(400).json({
          error:
            'INVALID DATA: Organization context is required and it could not be resolved. Please provide a valid organization ID as query param',
        });
      }

      if (!user.orgRole) {
        return res
          .status(403)
          .json({ error: 'PERMISSION ERROR: You do not belong to this organization' });
      }

      // Allow any authenticated member to remove themselves from an organization (leave).
      const isSelfRemoval =
        method === 'DELETE' &&
        /\/orgs\/[^/]+\/members\/[^/]+$/.test(apiPath) &&
        apiPath.split("/")[apiPath.split('/').length - 1].trim() === user.id;

      if (!isSelfRemoval && !matchingRule.allowedOrganizationRoles.includes(user.orgRole)) {
        return res
          .status(403)
          .json({
            error:
              "PERMISSION ERROR: Insufficient role for this action. If you're sure that you have the required role to perform this actions, you may be using an API key with limited permissions",
          });
      }
    }

    const entityError = await checkEntityPermissions(req, apiPath, method);
    if (entityError) {
      return res.status(403).json({ error: entityError });
    }

    next();
  } catch (error) {
    const { status, message } = handleError(error);
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  }
};

async function populateOrganizationContext(req: Request): Promise<void> {
  const organizationId = req.params.organizationId || extractOrganizationIdFromPath(req.path);

  if (organizationId && !req.params.organizationId) {
    req.params.organizationId = organizationId;
  }

  if (organizationId) {
    const organizationRepository = container.resolve('organizationRepository');
    const organizationService = container.resolve('organizationService');

    const organization = await organizationRepository.findById(organizationId);

    if (organization) {
      (req as any).org = organization;

      const role = await organizationService.getUserOrgRole((req as any).user.id, organizationId);

      if ((req as any).authType === 'api-key' && (req as any).user.apiKey) {
        const scope = _resolveApiKeyScope(
          (req as any).user.apiKey,
          organizationId,
          organization.ancestors
        );

        if (!scope) {
          throw new Error('PERMISSION ERROR: API Key does not have access to this organization');
        }

        (req as any).user.orgRole = _intersectRoleWithScope(role, scope);
      } else {
        if (!role && (req as any).user.role !== 'ADMIN') {
          throw new Error('PERMISSION ERROR: You do not belong to this organization');
        }

        (req as any).user.orgRole = (req as any).user.role === 'ADMIN' ? 'OWNER' : role;
      }
    } else {
      throw new Error('NOT FOUND: Organization not found');
    }
  }
}

function _resolveApiKeyScope(
  apiKey: ApiKey,
  orgId: string,
  ancestors: string[]
): string | undefined {
  const resolvedScope = apiKey.scopes.find((s: any) => {
    if (s.scope === 'ALL') {
      return [orgId, ...ancestors].includes(String(s.organizationId));
    }

    return String(s.organizationId) === orgId;
  });

  return resolvedScope?.scope;
}

function _intersectRoleWithScope(
  orgRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null,
  apiKeyScope: string
): 'OWNER' | 'ADMIN' | 'MEMBER' {
  if (apiKeyScope === 'VIEW') {
    return 'MEMBER';
  }

  if (apiKeyScope === 'MANAGEMENT') {
    return orgRole && ROLE_WEIGHT[orgRole] >= ROLE_WEIGHT.ADMIN ? 'ADMIN' : (orgRole ?? 'MEMBER');
  }

  return orgRole ?? 'MEMBER';
}

function _resolveEntityTypeFromPath(apiPath: string): EntityType | null {
  const segments = apiPath.split('/').filter(Boolean);
  if (segments[0] === 'pricings' && segments.length >= 2) {
    return 'pricing';
  }
  if (segments[0] === 'collections' && segments.length >= 2) {
    return 'collection';
  }
  return null;
}

function _mapMethodToPermission(method: HttpMethod, isGet: boolean): PermissionType | null {
  if (isGet) return 'GET';
  if (method === 'PUT' || method === 'PATCH') return 'PUT';
  if (method === 'DELETE') return 'DELETE';
  return null;
}

async function checkEntityPermissions(
  req: Request,
  apiPath: string,
  method: HttpMethod
): Promise<string | null> {
  const entityType = _resolveEntityTypeFromPath(apiPath);
  if (!entityType) return null;

  const user = (req as any).user;
  if (!user) return null;

  const organizationId = req.params.organizationId;
  if (!organizationId) return null;

  const segments = apiPath.split('/').filter(Boolean);
  const entityName = segments[1];
  if (!entityName) return null;

  if (segments.includes('permissions')) return null;

  const permissionEngine = new PermissionEngine();

  // For POST (creation), check org-scoped CREATE permission
  if (method === 'POST') {
    const permissionQueries = new (await import('../policies/queries/PermissionQueries')).PermissionQueries();
    const batchCtx = await permissionQueries.buildBatchContext(
      user.id,
      organizationId,
      user.orgRole,
      user.role === 'ADMIN'
    );

    const result = permissionEngine.evaluate({
      userId: user.id,
      organizationId,
      entityType,
      action: 'CREATE',
      userOrgRole: user.orgRole,
      isGlobalAdmin: user.role === 'ADMIN',
      orgPermissions: batchCtx.orgPermissions.get(entityType),
    });

    if (!result.allowed) {
      return result.reason || `PERMISSION ERROR: You do not have CREATE permission for ${entityType} in this organization`;
    }

    return null;
  }

  const permissionType = _mapMethodToPermission(method, method === 'GET');
  if (!permissionType) return null;

  if (permissionType === 'GET') {
    const entityRepo = entityType === 'pricing'
      ? container.resolve('pricingRepository')
      : container.resolve('pricingCollectionRepository');

    let entity;
    if (entityType === 'pricing') {
      entity = await entityRepo.findOne(entityName, organizationId, { includePrivate: true });
    } else {
      console.log('Checking collection permissions for', entityName, organizationId);
      entity = await entityRepo.findByOrganizationAndSlug(organizationId, entityName);
    }

    if (!entity) return null;

    const isPrivate = entity.private === true;
    const entityId = entityType === 'pricing'
      ? (entity.versions?.[0]?._id?.toString() ?? entity.versions?.[0]?.id)
      : (entity._id?.toString() ?? entity.id);

    const result = permissionEngine.evaluate({
      userId: user.id,
      organizationId,
      entityType,
      entityId,
      action: 'GET',
      isPrivate,
      userOrgRole: user.orgRole,
      isGlobalAdmin: user.role === 'ADMIN',
    });

    if (!result.allowed) {
      return result.reason || `PERMISSION ERROR: You do not have GET permission on this ${entityType}`;
    }

    return null;
  }

  let entityId: string | null = null;
  let isPrivate = false;
  if (entityType === 'pricing') {
    const pricingRepo = container.resolve('pricingRepository');
    const pricing = await pricingRepo.findOne(entityName, organizationId, { includePrivate: true });
    if (pricing && pricing.versions && pricing.versions.length > 0) {
      entityId = pricing.versions[0]._id?.toString() ?? pricing.versions[0].id;
      isPrivate = pricing.private === true;
    }
  } else {
    const collectionRepo = container.resolve('pricingCollectionRepository');
    const collection = await collectionRepo.findByOrganizationAndSlug(organizationId, entityName);
    if (collection) {
      entityId = collection._id?.toString() ?? (collection as any).id;
      isPrivate = collection.private === true;
    }
  }

  if (!entityId) return null;

  const result = permissionEngine.evaluate({
    userId: user.id,
    organizationId,
    entityType,
    entityId,
    action: permissionType,
    isPrivate,
    userOrgRole: user.orgRole,
    isGlobalAdmin: user.role === 'ADMIN',
  });

  if (!result.allowed) {
    return result.reason || `PERMISSION ERROR: You do not have ${permissionType} permission on this ${entityType}`;
  }

  return null;
}

export { authorizationMiddleware };
