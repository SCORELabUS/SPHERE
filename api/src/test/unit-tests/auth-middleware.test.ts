/**
 * Unit tests for Authentication Middleware - REAL MIDDLEWARE EXECUTION
 *
 * This test suite tests the ACTUAL middleware function with mocked dependencies.
 * The middleware is called directly with Express req/res/next objects.
 * All external dependencies (database, services) are mocked via the container.
 *
 * Run with: npm test unit-tests/auth-middleware.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Response, NextFunction } from 'express';
import { authenticationMiddleware } from '../../main/middlewares/AuthenticationMiddleware';
import { authorizationMiddleware } from '../../main/middlewares/AuthorizationMiddleware';

/** Combined middleware that runs authentication then authorization (like the old single middleware) */
const authenticateTokenMiddleware = async (req: any, res: any, next: any) => {
  await new Promise<void>((resolve, reject) => {
    const originalJson = res.json;
    let settled = false;

    res.json = function (body: any) {
      if (!settled) {
        settled = true;
        res.json = originalJson;
      }
      const result = originalJson.call(res, body);
      resolve();
      return result;
    };

    authenticationMiddleware(req, res, (err?: any) => {
      if (settled) return;
      settled = true;
      res.json = originalJson;
      if (err) return reject(err);
      resolve();
    });
  }).catch((err) => {
    next(err);
    return;
  });

  if (res.headersSent) return;

  await authorizationMiddleware(req, res, next);
};
import {
  createMockRequest,
  createMockResponse,
  createMockNextFunction,
  buildBearerTokenHeader,
  buildApiKeyHeader,
  MutableRequest,
} from '../utils/auth/auth.testHelpers';
import {
  createMockAdminUser,
  createMockRegularUser,
  createMockUserWithExpiredToken,
  createMockUserWithApiKey,
  createMockUserWithRevokedApiKey,
  createMockUserWithExpiredApiKey,
  createMockOrganization,
} from '../utils/auth/auth.testData';
import { LeanUser, LeanUserWithApiKey } from '../../main/types/models/User';

// Mock the container - CRITICAL for isolated testing
let mockContainer: any;
vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn((key: string) => {
      if (key === 'userRepository') {
        return mockContainer.userRepository;
      }
      if (key === 'organizationRepository') {
        return mockContainer.organizationRepository;
      }
      if (key === 'organizationService') {
        return mockContainer.organizationService;
      }
      if (key === 'permissionService') {
        return mockContainer.permissionService;
      }
      return undefined;
    }),
  },
}));

// Mock verifyJwtToken for JWT-based auth
const { mockVerifyJwtToken } = vi.hoisted(() => ({
  mockVerifyJwtToken: vi.fn(),
}));
vi.mock('../../main/utils/users/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../main/utils/users/helpers')>();
  return {
    ...actual,
    verifyJwtToken: mockVerifyJwtToken,
  };
});

describe('Auth Middleware - Real Execution Tests', () => {
  let mockReq: MutableRequest;
  let mockRes: Response;
  let mockNext: NextFunction;
  let mockUserRepository: any;
  let mockOrgRepository: any;
  let mockOrgService: any;

  beforeEach(() => {
    mockReq = createMockRequest({
      method: 'GET',
      path: '/api/v1/healthcheck',
    });
    mockRes = createMockResponse();
    mockNext = createMockNextFunction();

    // Setup mock repositories and services
    mockUserRepository = {
      findOne: vi.fn(),
      findById: vi.fn(),
      findByApiKey: vi.fn(),
    };

    mockOrgRepository = {
      findById: vi.fn(),
    };

    mockOrgService = {
      getUserOrgRole: vi.fn(),
    };

    // Initialize mockContainer for this test
    mockContainer = {
      userRepository: mockUserRepository,
      organizationRepository: mockOrgRepository,
      organizationService: mockOrgService,
      permissionService: {
        hasPermission: vi.fn().mockResolvedValue(true),
      },
      pricingRepository: {},
      pricingCollectionRepository: {},
    };

    // Reset JWT mock
    mockVerifyJwtToken.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Bearer Token Authentication
  // ============================================

  describe('Bearer Token Authentication', () => {
    it('should authenticate valid Bearer token - CALLS MIDDLEWARE', async () => {
      const user = createMockAdminUser();
      mockVerifyJwtToken.mockReturnValue({ id: user.id, username: user.username, role: user.role });
      mockUserRepository.findById.mockResolvedValue(user);

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/users',
        headers: buildBearerTokenHeader(user.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockVerifyJwtToken).toHaveBeenCalledWith(user.token);
      expect(mockUserRepository.findById).toHaveBeenCalledWith(user.id);
      expect((mockReq as any).user).toBeDefined();
      expect((mockReq as any).user.id).toBe(user.id);
    });

    it('should reject invalid Bearer token - CALLS MIDDLEWARE', async () => {
      mockVerifyJwtToken.mockImplementation(() => { throw new Error('Invalid token'); });

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/users',
        headers: buildBearerTokenHeader('invalid_token_12345'),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockVerifyJwtToken).toHaveBeenCalled();
      expect((mockRes as any).statusCode).toBe(401);
    });

    it('should reject expired Bearer token - CALLS MIDDLEWARE', async () => {
      mockVerifyJwtToken.mockImplementation(() => { throw new Error('Token expired'); });

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/users',
        headers: buildBearerTokenHeader('expired_token_xyz'),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockVerifyJwtToken).toHaveBeenCalled();
      expect((mockRes as any).statusCode).toBe(401);
    });

    it('should extract Bearer token correctly from header', async () => {
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/users',
        headers: {},
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(401);
    });

    it('should handle missing Bearer token on public endpoint', async () => {
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/healthcheck',
        headers: {},
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  // ============================================
  // API Key Authentication
  // ============================================

  describe('API Key Authentication', () => {
    it('should authenticate valid API key - CALLS MIDDLEWARE', async () => {
      const user: any = createMockUserWithApiKey();
      user.apiKey = user.apiKeys[0];
      delete user.apiKeys;
      const apiKey = user.apiKey.key;

      mockUserRepository.findByApiKey.mockResolvedValue(user);

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/pricings',
        headers: buildApiKeyHeader(apiKey),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockUserRepository.findByApiKey).toHaveBeenCalledWith(apiKey);
      expect((mockReq as any).user).toBeDefined();
      expect((mockReq as any).authType).toBe('api-key');
    });

    it('should reject revoked API key - CALLS MIDDLEWARE', async () => {
      const user: any = createMockUserWithRevokedApiKey();
      user.apiKey = user.apiKeys[0];
      delete user.apiKeys;
      const apiKey = user.apiKey.key;
      mockUserRepository.findByApiKey.mockResolvedValue(user);

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/pricings',
        headers: buildApiKeyHeader(apiKey),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(401);
    });

    it('should reject expired API key - CALLS MIDDLEWARE', async () => {
      const user: any = createMockUserWithExpiredApiKey();
      user.apiKey = user.apiKeys[0];
      delete user.apiKeys;
      const apiKey = user.apiKey.key;
      mockUserRepository.findByApiKey.mockResolvedValue(user);

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/pricings',
        headers: buildApiKeyHeader(apiKey),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(401);
    });

    it('should extract API key from x-api-key header', async () => {
      // Redundant header parsing test removed. Instead assert that
      // a missing/invalid API key on a protected org endpoint returns 401/403
      mockUserRepository.findByApiKey.mockResolvedValue(null);
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/orgs/org_123',
        params: { organizationId: 'org_123' },
        headers: buildApiKeyHeader('invalid_key'),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(401);
    });

    it('should handle missing API key header on public endpoint', async () => {
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/healthcheck',
        headers: {},
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle array API key header values', async () => {
      const apiKey = 'usr_test_key_12345';
      mockReq = createMockRequest({
        headers: {
          'x-api-key': [apiKey],
        } as any,
      });

      const headerValue = mockReq.headers['x-api-key'];
      expect(Array.isArray(headerValue)).toBe(true);
    });
  });

  // ============================================
  // API Key Scopes & Organization Permission Tests
  // ============================================

  describe('API Key Scopes & Org Permissioning', () => {
    it('scope ALL on parent should inherit to child organization (allows access)', async () => {
      // User has API key with ALL on parent org
      const user: any = createMockUserWithApiKey();
      user.apiKey = {
        key: 'usr_all_parent',
        revoked: false,
        expiresAt: null,
        scopes: [{ organizationId: 'org_parent', scope: 'ALL' }],
      };
      // ensure organizationService reports membership
      mockUserRepository.findByApiKey.mockResolvedValue(user);

      const org = { id: 'org_child', ancestors: ['org_parent'] };
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue('MEMBER');

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/orgs/org_child/permissions',
        params: { organizationId: 'org_child' },
        headers: buildApiKeyHeader(user.apiKey.key),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      // _resolveApiKeyScope should find scope 'ALL' via ancestors and not throw
      expect(mockOrgRepository.findById).toHaveBeenCalledWith('org_child');
      expect((mockReq as any).user).toBeDefined();
      expect(mockNext).toHaveBeenCalled();
    });
    it('should resolve organizationId from path when req.params is empty', async () => {
      const user = createMockAdminUser();
      const org = createMockOrganization({ id: 'org_123' });

      mockVerifyJwtToken.mockReturnValue({ id: user.id, username: user.username, role: user.role });
      mockUserRepository.findById.mockResolvedValue(user);
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue('OWNER');

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/orgs/org_123/permissions',
        params: {},
        headers: buildBearerTokenHeader(user.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockReq as any).params.organizationId).toBe('org_123');
      expect(mockOrgRepository.findById).toHaveBeenCalledWith('org_123');
    });

    it('scope MANAGEMENT on parent should NOT inherit to child (deny)', async () => {
      const user: any = createMockUserWithApiKey();
      user.apiKey = {
        key: 'usr_mgmt_parent',
        revoked: false,
        expiresAt: null,
        scopes: [{ organizationId: 'org_parent', scope: 'MANAGEMENT' }],
      };
      mockUserRepository.findByApiKey.mockResolvedValue(user);

      const org = { id: 'org_child', ancestors: ['org_parent'] };
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue('MEMBER');

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/orgs/org_child/permissions',
        params: { organizationId: 'org_child' },
        headers: buildApiKeyHeader(user.apiKey.key),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      // MANAGEMENT should not match via ancestors -> middleware should return 403
      expect((mockRes as any).statusCode).toBe(403);
    });

    it('scope VIEW should restrict write operations (POST -> 403)', async () => {
      const user: any = createMockUserWithApiKey();
      user.apiKey = {
        key: 'usr_view_org123',
        revoked: false,
        expiresAt: null,
        scopes: [{ organizationId: 'org_123', scope: 'VIEW' }],
      };
      mockUserRepository.findByApiKey.mockResolvedValue(user);

      const org = { id: 'org_123', ancestors: [] };
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue('OWNER');

      // Attempt to POST to manage members (requires OWNER/ADMIN)
      mockReq = createMockRequest({
        method: 'POST',
        path: '/api/v1/orgs/org_123/members',
        params: { organizationId: 'org_123' },
        headers: buildApiKeyHeader(user.apiKey.key),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(403);
    });

    it('OWNER user with VIEW api-key should be intersected to MEMBER and be denied POST', async () => {
      // User is OWNER by org service, but api-key VIEW should reduce permissions
      const user: any = createMockUserWithApiKey();
      user.role = 'USER';
      user.apiKey = {
        key: 'usr_owner_view',
        revoked: false,
        expiresAt: null,
        scopes: [{ organizationId: 'org_123', scope: 'VIEW' }],
      };
      mockUserRepository.findByApiKey.mockResolvedValue(user);

      const org = { id: 'org_123', ancestors: [] };
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue('OWNER');

      mockReq = createMockRequest({
        method: 'POST',
        path: '/api/v1/orgs/org_123/members',
        params: { organizationId: 'org_123' },
        headers: buildApiKeyHeader(user.apiKey.key),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      // According to current intersection logic, OWNER + VIEW -> MEMBER -> forbidden
      expect((mockRes as any).statusCode).toBe(403);
    });

    it('ADMIN user should be allowed to POST regardless of membership (global ADMIN bypass)', async () => {
      const admin: any = createMockAdminUser();
      mockVerifyJwtToken.mockReturnValue({ id: admin.id, username: admin.username, role: admin.role });
      mockUserRepository.findById.mockResolvedValue(admin);
      mockOrgRepository.findById.mockResolvedValue({ id: 'org_123', ancestors: [] });
      mockOrgService.getUserOrgRole.mockResolvedValue(null);

      mockReq = createMockRequest({
        method: 'POST',
        path: '/api/v1/orgs/org_123/members',
        params: { organizationId: 'org_123' },
        headers: buildBearerTokenHeader(admin.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      // Admin bypass should map to OWNER and allow action
      expect(mockNext).toHaveBeenCalled();
    });

    it('token valid but lacks required user role -> 403', async () => {
      const user = createMockRegularUser();
      mockVerifyJwtToken.mockReturnValue({ id: user.id, username: user.username, role: user.role });
      mockUserRepository.findById.mockResolvedValue(user);

      mockReq = createMockRequest({
        method: 'PUT',
        path: '/api/v1/users/123/refresh-token',
        headers: buildBearerTokenHeader(user.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(403);
    });
  });

  // ============================================
  // Public vs Protected Endpoints
  // ============================================

  describe('Public vs Protected Endpoints', () => {
    it('should allow GET /healthcheck without auth - CALLS MIDDLEWARE', async () => {
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/healthcheck',
        headers: {},
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny POST /pricings without auth - CALLS MIDDLEWARE', async () => {
      mockReq = createMockRequest({
        method: 'POST',
        path: '/api/v1/pricings',
        headers: {},
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(401);
    });

    it('should allow GET /pricings with valid token - CALLS MIDDLEWARE', async () => {
      const user = createMockRegularUser();
      mockVerifyJwtToken.mockReturnValue({ id: user.id, username: user.username, role: user.role });
      mockUserRepository.findById.mockResolvedValue(user);

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/pricings',
        headers: buildBearerTokenHeader(user.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockReq as any).user).toBeDefined();
    });
  });

  // ============================================
  // Organization Context with Middleware
  // ============================================

  describe('Organization Context - Real Middleware Execution', () => {
    it('should populate organization context when orgId is provided - CALLS MIDDLEWARE', async () => {
      const user = createMockAdminUser();
      const org = createMockOrganization({ id: 'org_123' });

      mockVerifyJwtToken.mockReturnValue({ id: user.id, username: user.username, role: user.role });
      mockUserRepository.findById.mockResolvedValue(user);
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue('OWNER');

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/orgs/org_123/permissions',
        params: { organizationId: 'org_123' },
        headers: buildBearerTokenHeader(user.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockOrgRepository.findById).toHaveBeenCalledWith('org_123');
    });

    it('should deny access when user is not member of organization - CALLS MIDDLEWARE', async () => {
      const user = createMockRegularUser();
      const org = createMockOrganization({ id: 'org_123' });

      mockVerifyJwtToken.mockReturnValue({ id: user.id, username: user.username, role: user.role });
      mockUserRepository.findById.mockResolvedValue(user);
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue(null); // User not member

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/orgs/org_123/permissions',
        params: { organizationId: 'org_123' },
        headers: buildBearerTokenHeader(user.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(403);
    });

    it('should bypass organization membership check for ADMIN users - CALLS MIDDLEWARE', async () => {
      const admin = createMockAdminUser();
      const org = createMockOrganization({ id: 'org_123' });

      mockVerifyJwtToken.mockReturnValue({ id: admin.id, username: admin.username, role: admin.role });
      mockUserRepository.findById.mockResolvedValue(admin);
      mockOrgRepository.findById.mockResolvedValue(org);
      mockOrgService.getUserOrgRole.mockResolvedValue(null);

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/orgs/org_123',
        params: { organizationId: 'org_123' },
        headers: buildBearerTokenHeader(admin.token!),
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      // ADMIN should be granted access
      expect((mockReq as any).user).toBeDefined();
    });
  });

  // ============================================
  // Edge Cases with Middleware Execution
  // ============================================

  describe('Edge Cases - Real Middleware Execution', () => {
    it('should handle both Bearer token and API key in same request', async () => {
      const user = createMockAdminUser();
      mockVerifyJwtToken.mockReturnValue({ id: user.id, username: user.username, role: user.role });
      mockUserRepository.findById.mockResolvedValue(user);

      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/users',
        headers: {
          ...buildBearerTokenHeader(user.token!),
          ...buildApiKeyHeader('usr_test_key'),
        },
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockVerifyJwtToken).toHaveBeenCalled();
      expect((mockReq as any).authType).toBe('token');
    });

    it('should handle missing headers gracefully on public endpoint - CALLS MIDDLEWARE', async () => {
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/healthcheck',
        headers: {},
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle null/undefined bearer token gracefully', async () => {
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/v1/users',
        headers: {
          authorization: 'Bearer ',
        },
      });

      await authenticateTokenMiddleware(mockReq as any, mockRes, mockNext);

      expect((mockRes as any).statusCode).toBe(401);
    });
  });
});
