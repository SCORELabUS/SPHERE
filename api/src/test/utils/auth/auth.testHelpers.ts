/**
 * Test helpers for authentication middleware tests
 * Provides utilities for mocking Express objects and creating test scenarios
 */

import { Request, Response, NextFunction } from 'express';
import { LeanUser } from '../../../main/types/models/User';
import { createMockAdminUser, createMockUserWithApiKey } from './auth.testData';
import { vi } from 'vitest';

export type MutableRequest = Omit<Request, 'path'> & {
  path: string;
};

/**
 * Creates a mock Express Request object
 */
export const createMockRequest = (overrides?: Partial<MutableRequest>): MutableRequest => {
  const req = {
    method: 'GET',
    path: '/api/v1/users',
    headers: {} as any,
    params: {},
    query: {},
    body: {},
    get: (header: string) => req.headers[header.toLowerCase()],
    user: undefined,
    org: undefined,
    authType: undefined,
    ...overrides,
  } as any;

  return req as MutableRequest;
};

/**
 * Creates a mock Express Response object with chainable methods
 */
export const createMockResponse = (overrides?: Partial<Response>): Response => {
  const res = {
    headersSent: false,
    statusCode: 200,
    locals: {},
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    json: function (data: any) {
      this.body = data;
      return this;
    },
    send: function (data: any) {
      this.body = data;
      return this;
    },
    set: function (key: string, value: string) {
      this.headers = this.headers || {};
      this.headers[key] = value;
      return this;
    },
    ...overrides,
  } as any;

  return res as Response;
};

/**
 * Creates a mock NextFunction callback
 */
export const createMockNextFunction = (): NextFunction & { calledWith?: any } => {
  return vi.fn();
};

/**
 * Builds Bearer token header
 */
export const buildBearerTokenHeader = (token: string): { authorization: string } => {
  return {
    authorization: `Bearer ${token}`,
  };
};

/**
 * Builds API Key header
 */
export const buildApiKeyHeader = (apiKey: string): { 'x-api-key': string } => {
  return {
    'x-api-key': apiKey,
  };
};

/**
 * Creates a mock request with Bearer token authentication
 */
export const createAuthenticatedRequest = (
  user: LeanUser,
  overrides?: Partial<MutableRequest>
): MutableRequest => {
  return createMockRequest({
    headers: buildBearerTokenHeader(user.token!),
    path: '/api/v1/users',
    ...overrides,
  });
};

/**
 * Creates a mock request with API Key authentication
 */
export const createRequestWithApiKey = (apiKey: string, overrides?: Partial<MutableRequest>): MutableRequest => {
  return createMockRequest({
    headers: buildApiKeyHeader(apiKey),
    path: '/api/v1/users',
    ...overrides,
  });
};

/**
 * Creates a mock request with organization context
 */
export const createRequestWithOrgContext = (
  organizationId: string,
  user?: LeanUser,
  overrides?: Partial<MutableRequest>
): MutableRequest => {
  const baseRequest = user ? createAuthenticatedRequest(user) : createMockRequest();
  return createMockRequest({
    ...baseRequest,
    params: {
      organizationId,
      ...overrides?.params,
    },
    path: `/api/v1/orgs/${organizationId}/members`,
    ...overrides,
  });
};

/**
 * Helper to check if a response has an error status
 */
export const isErrorResponse = (status: number): boolean => {
  return status >= 400;
};

/**
 * Helper to check if response is successful
 */
export const isSuccessResponse = (status: number): boolean => {
  return status >= 200 && status < 300;
};

/**
 * Extracts API key from request headers
 */
export const extractApiKeyFromRequest = (req: MutableRequest): string | null => {
  const headerValue = req.headers['x-api-key'];
  if (Array.isArray(headerValue)) {
    return headerValue[0] || null;
  }
  return (headerValue as string) || null;
};

/**
 * Extracts Bearer token from request headers
 */
export const extractBearerTokenFromRequest = (req: MutableRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
};

/**
 * Builds a complete authorization header object from user and auth type
 */
export const buildAuthHeaders = (
  user: LeanUser | null,
  authType: 'token' | 'api_key' | 'none' = 'token'
): Record<string, string> => {
  if (!user || authType === 'none') {
    return {};
  }

  if (authType === 'token' && user.token) {
    return buildBearerTokenHeader(user.token);
  }

  if (authType === 'api_key' && user.apiKeys && user.apiKeys.length > 0) {
    return buildApiKeyHeader(user.apiKeys[0].key);
  }

  return {};
};

/**
 * Test helper to format endpoint path for matching
 * Converts path with parameters to the format used by permission matching
 */
export const formatEndpointPath = (path: string): string => {
  // Replace parameter names with wildcards
  return path.replace(/:[a-zA-Z]+/g, '*').replace(/\/+/g, '/');
};

/**
 * Mock user repository methods commonly used in middleware
 */
export const createMockUserRepository = () => {
  return {
    findOne: async (query: any) => {
      if (query.token === 'valid_token') {
        return createMockAdminUser({ token: 'valid_token' });
      }
      return null;
    },
    findByApiKey: async (apiKey: string) => {
      if (apiKey === 'valid_api_key') {
        return createMockUserWithApiKey();
      }
      return null;
    },
  };
};

/**
 * Mock organization repository methods commonly used in middleware
 */
export const createMockOrganizationRepository = () => {
  return {
    findById: async (id: string) => {
      return {
        id,
        name: `Organization ${id}`,
        ancestors: [],
      };
    },
  };
};

/**
 * Mock organization service methods
 */
export const createMockOrganizationService = () => {
  return {
    getUserOrgRole: async (user: LeanUser, orgId: string) => {
      // Default mock behavior - return MEMBER role
      return 'MEMBER';
    },
  };
};

/**
 * Creates a container-like mock for dependency injection
 */
export const createMockContainer = (overrides?: any) => {
  const defaults = {
    userRepository: createMockUserRepository(),
    organizationRepository: createMockOrganizationRepository(),
    organizationService: createMockOrganizationService(),
  };

  return {
    resolve: (key: string) => overrides?.[key] || defaults[key as keyof typeof defaults],
    ...overrides,
  };
};
