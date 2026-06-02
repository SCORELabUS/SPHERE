/**
 * Test data fixtures for authentication middleware tests
 * Provides reusable mock data for users, organizations, and API keys
 */

import { LeanUser, ApiKey } from '../../../main/types/models/User';

/**
 * Mock user data generator
 */
export const createMockUser = (overrides?: any): LeanUser => {
  const id = Math.random().toString(36).substring(7);
  return {
    id,
    username: `testuser_${id}`,
    password: 'hashed_password',
    role: 'USER',
    firstName: 'Test',
    lastName: 'User',
    email: `test_${id}@example.com`,
    avatar: `${process.env.SERVER_STATICS_FOLDER || 'public/'}${process.env.AVATARS_FOLDER || 'static/avatars/users'}/default-avatar.png`,
    token: `token_${id}`,
    tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
    apiKeys: [],
    ...overrides,
  };
};

/**
 * Mock ADMIN user
 */
export const createMockAdminUser = (overrides?: Partial<LeanUser>): LeanUser => {
  return createMockUser({
    role: 'ADMIN',
    username: `admin_${Math.random().toString(36).substring(7)}`,
    ...overrides,
  });
};

/**
 * Mock regular user
 */
export const createMockRegularUser = (overrides?: Partial<LeanUser>): LeanUser => {
  return createMockUser({
    role: 'USER',
    ...overrides,
  });
};

/**
 * Mock user with expired token
 */
export const createMockUserWithExpiredToken = (overrides?: Partial<LeanUser>): LeanUser => {
  return createMockUser({
    token: `expired_token_${Math.random().toString(36).substring(7)}`,
    tokenExpiration: new Date(Date.now() - 1000), // Expired 1 second ago
    ...overrides,
  });
};

/**
 * Mock user with API key
 */
export const createMockUserWithApiKey = (overrides?: Partial<LeanUser>): LeanUser => {
  const apiKey: ApiKey = {
    key: `usr_${Math.random().toString(36).substring(2, 15)}`,
    revoked: false,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    scopes: [
      {
        organizationId: 'org_123',
        scope: 'ALL',
      },
    ],
  };
  return createMockUser({
    apiKeys: [apiKey],
    ...overrides,
  });
};

/**
 * Mock user with revoked API key
 */
export const createMockUserWithRevokedApiKey = (overrides?: Partial<LeanUser>): LeanUser => {
  const apiKey: ApiKey = {
    key: `usr_${Math.random().toString(36).substring(2, 15)}`,
    revoked: true,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    scopes: [
      {
        organizationId: 'org_123',
        scope: 'ALL',
      },
    ],
  };
  return createMockUser({
    apiKeys: [apiKey],
    ...overrides,
  });
};

/**
 * Mock user with expired API key
 */
export const createMockUserWithExpiredApiKey = (overrides?: Partial<LeanUser>): LeanUser => {
  const apiKey: ApiKey = {
    key: `usr_${Math.random().toString(36).substring(2, 15)}`,
    revoked: false,
    expiresAt: new Date(Date.now() - 1000), // Expired
    scopes: [
      {
        organizationId: 'org_123',
        scope: 'ALL',
      },
    ],
  };
  return createMockUser({
    apiKeys: [apiKey],
    ...overrides,
  });
};

/**
 * Mock user with API key with VIEW scope (read-only)
 */
export const createMockUserWithViewScopeApiKey = (
  organizationId: string = 'org_123',
  overrides?: Partial<LeanUser>
): LeanUser => {
  const apiKey: ApiKey = {
    key: `usr_${Math.random().toString(36).substring(2, 15)}`,
    revoked: false,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    scopes: [
      {
        organizationId,
        scope: 'VIEW',
      },
    ],
  };
  return createMockUser({
    apiKeys: [apiKey],
    ...overrides,
  });
};

/**
 * Mock user with API key with MANAGEMENT scope
 */
export const createMockUserWithManagementScopeApiKey = (
  organizationId: string = 'org_123',
  overrides?: Partial<LeanUser>
): LeanUser => {
  const apiKey: ApiKey = createMockApiKey(organizationId, {scopes: [{ organizationId, scope: 'MANAGEMENT' }]});
  return createMockUser({
    apiKeys: [apiKey],
    ...overrides,
  });
};

/**
 * Mock user with multiple API keys with different scopes
 */
export const createMockUserWithMultiScopeApiKeys = (
  organizationIds: string[] = ['org_123', 'org_456'],
  overrides?: Partial<LeanUser>
): LeanUser => {
  const apiKeys: ApiKey[] = organizationIds.map((orgId) => createMockApiKey(orgId));

  return createMockUser({
    apiKeys,
    ...overrides,
  });
};

/**
 * Mock organization data
 */
export const createMockOrganization = (overrides?: any) => {
  const id = Math.random().toString(36).substring(7);
  return {
    id: `org_${id}`,
    name: `Test Organization ${id}`,
    description: 'A test organization',
    ancestors: [],
    ...overrides,
  };
};

export const createMockApiKey = (organizationId: string, overrides?: Partial<ApiKey>): ApiKey => {
  const apiKey: ApiKey = {
    key: overrides?.key || `usr_${Math.random().toString(36).substring(2, 15)}`,
    revoked: overrides?.revoked || false,
    expiresAt: overrides?.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    scopes: [
      {
        organizationId,
        scope: overrides?.scopes?.[0]?.scope || 'MANAGEMENT',
      },
    ],
  };
  return apiKey;
};

/**
 * Collection of common test scenarios
 */
export const TEST_SCENARIOS = {
  // Unauthenticated
  unauthenticated: {
    user: null,
    token: null,
    apiKey: null,
  },

  // Valid user with token
  validAdminWithToken: {
    user: createMockAdminUser(),
    authType: 'token' as const,
  },

  validUserWithToken: {
    user: createMockRegularUser(),
    authType: 'token' as const,
  },

  // Invalid/expired credentials
  expiredToken: {
    user: createMockUserWithExpiredToken(),
    authType: 'token' as const,
  },

  invalidToken: {
    user: null,
    token: 'invalid_token_12345',
    authType: 'token' as const,
  },

  // API Keys
  validApiKey: {
    user: createMockUserWithApiKey(),
    authType: 'api_key' as const,
  },

  revokedApiKey: {
    user: createMockUserWithRevokedApiKey(),
    authType: 'api_key' as const,
  },

  expiredApiKey: {
    user: createMockUserWithExpiredApiKey(),
    authType: 'api_key' as const,
  },

  invalidApiKey: {
    apiKey: 'usr_invalid_key_12345',
    authType: 'api_key' as const,
  },

  // API Keys with scopes
  viewScopeApiKey: {
    user: createMockUserWithViewScopeApiKey(),
    authType: 'api_key' as const,
  },

  managementScopeApiKey: {
    user: createMockUserWithManagementScopeApiKey(),
    authType: 'api_key' as const,
  },
};
