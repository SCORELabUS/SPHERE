import { useCallback } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { EntityPermission, EntityType, SetPermissionPayload } from '../types/permissions';

export const ORGS_BASE_PATH = import.meta.env.VITE_API_URL + '/orgs';

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface Organization {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  avatar: string | null;
  avatarBgColor?: string;
  avatarFgColor?: string;
  isPersonal: boolean;
  _parentId: string | null;
  ancestors: string[];
  role?: OrgRole;
  subOrganizations?: Organization[];
  createdAt?: string;
}

export interface OrgMemberWithUser {
  id: string;
  role: OrgRole;
  joinedAt: string;
  user: {
    id: string;
    username: string;
    email: string;
    avatar: string | null;
    avatarBgColor?: string;
    avatarFgColor?: string;
  };
}

export interface OrganizationInvitation {
  id: string;
  code: string;
  createdBy: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
}

export interface OrgPricing {
  id: string;
  name: string;
  version: string;
  createdAt: string;
  currency: string;
  private: boolean;
  organization: { id: string; name: string; displayName: string; avatar: string };
  collection: { id: string; name: string; slug: string } | null;
  analytics: {
    configurationSpaceSize: number;
    minSubscriptionPrice: number;
    maxSubscriptionPrice: number;
  };
}

export interface OrgCollection {
  id: string;
  name: string;
  slug: string;
  numberOfPricings: number;
  organization: { id: string; name: string; displayName: string; avatar: string };
}

export function useOrganizationsApi() {
  const { fetchWithInterceptor, authUser } = useAuth();
  const token = authUser?.token;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const getMyOrganizations = useCallback(async (params?: { limit?: number; offset?: number }): Promise<Organization[] | { items: Organization[]; total: number }> => {
    const qs = new URLSearchParams();
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const query = qs.toString();
    const response = await fetchWithInterceptor(`${import.meta.env.VITE_API_URL}/users/me/orgs${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch organizations');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const getOrganization = useCallback(async (orgId: string): Promise<Organization> => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Organization not found');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const createOrganization = useCallback(async (payload: {
    name: string;
    displayName: string;
    description?: string;
    isPersonal?: boolean;
    _parentId?: string;
  }) => {
    const response = await fetchWithInterceptor(ORGS_BASE_PATH, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to create organization');
    return body as Organization;
  }, [fetchWithInterceptor, token]);

  const updateOrganization = useCallback(async (orgId: string, payload: {
    displayName?: string;
    description?: string | null;
    avatar?: string | null;
  }) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to update organization');
    return body as Organization;
  }, [fetchWithInterceptor, token]);

  const deleteOrganization = useCallback(async (orgId: string) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}`, {
      method: 'DELETE',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to delete organization');
    return body;
  }, [fetchWithInterceptor, token]);

  const getOrgMembers = useCallback(async (orgId: string): Promise<OrgMemberWithUser[]> => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/members`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch members');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const addMember = useCallback(async (orgId: string, userId: string, role: OrgRole) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/members`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, role }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to add member');
    return body;
  }, [fetchWithInterceptor, token]);

  const updateMemberRole = useCallback(async (orgId: string, userId: string, role: OrgRole) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/members/${userId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to update member role');
    return body;
  }, [fetchWithInterceptor, token]);

  const removeMember = useCallback(async (orgId: string, userId: string) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/members/${userId}`, {
      method: 'DELETE',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to remove member');
    return body;
  }, [fetchWithInterceptor, token]);

  const listInvitations = useCallback(async (orgId: string): Promise<OrganizationInvitation[]> => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/invitations`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch invitations');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const createInvitation = useCallback(async (orgId: string, options?: { expiresInDays?: number; maxUses?: number }) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/invitations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(options ?? {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to create invitation');
    return body as OrganizationInvitation;
  }, [fetchWithInterceptor, token]);

  const revokeInvitation = useCallback(async (orgId: string, invitationId: string) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/invitations/${invitationId}`, {
      method: 'DELETE',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to revoke invitation');
    return body;
  }, [fetchWithInterceptor, token]);

  const previewInvitation = useCallback(async (code: string) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/invitations/preview/${code}`, {
      method: 'GET',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Invitation not found or expired');
    return body as { invitation: OrganizationInvitation; organization: Organization };
  }, [fetchWithInterceptor, token]);

  const joinViaInvitation = useCallback(async (code: string) => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/join/${code}`, {
      method: 'POST',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to join organization');
    return body as Organization;
  }, [fetchWithInterceptor, token]);

  const lookupUserByUsername = useCallback(async (username: string) => {
    const response = await fetchWithInterceptor(`${import.meta.env.VITE_API_URL}/users/${username}`, {
      method: 'GET',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'User not found');
    return body;
  }, [fetchWithInterceptor, token]);

  const getOrgChildren = useCallback(async (orgId: string): Promise<Organization[]> => {
    const org = await getOrganization(orgId);
    const children = await Promise.all(
      (org as any).subOrganizations?.map((child: any) => getOrganization(child.id ?? child._id)) ?? []
    );
    return children;
  }, [getOrganization]);

  const getOrgPricings = useCallback(async (orgId: string, filters?: Record<string, string>): Promise<{ pricings: OrgPricing[]; total: number }> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.set(k, v);
      });
    }
    const response = await fetchWithInterceptor(`${import.meta.env.VITE_API_URL}/pricings/${orgId}?${params.toString()}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch organization pricings');
    const data = await response.json();
    return { pricings: data.pricings ?? [], total: data.total ?? 0 };
  }, [fetchWithInterceptor, token]);

  const getOrgCollections = useCallback(async (orgId: string, filters?: Record<string, string>): Promise<{ collections: OrgCollection[]; total: number }> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.set(k, v);
      });
    }
    const qs = params.toString();
    const response = await fetchWithInterceptor(`${import.meta.env.VITE_API_URL}/collections/${orgId}${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch organization collections');
    const data = await response.json();
    return { collections: data.collections ?? [], total: data.total ?? 0 };
  }, [fetchWithInterceptor, token]);

  const getOrgPermissions = useCallback(async (orgId: string, entityType?: EntityType): Promise<EntityPermission[]> => {
    const url = entityType
      ? `${ORGS_BASE_PATH}/${orgId}/permissions?entityType=${entityType}`
      : `${ORGS_BASE_PATH}/${orgId}/permissions`;
    const response = await fetchWithInterceptor(url, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch permissions');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const setOrgPermission = useCallback(async (orgId: string, payload: SetPermissionPayload): Promise<EntityPermission> => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/permissions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to set permission');
    return body as EntityPermission;
  }, [fetchWithInterceptor, token]);

  const removeOrgPermission = useCallback(async (orgId: string, permissionId: string): Promise<void> => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/permissions/${permissionId}`, {
      method: 'DELETE',
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to remove permission');
  }, [fetchWithInterceptor, token]);

  const USERS_BASE_PATH = import.meta.env.VITE_API_URL + '/users';

  const getUserAccessiblePricings = useCallback(async (limit = 500): Promise<{ pricings: Array<{ name: string; permissions: { GET: boolean }; organization: { id: string; role: string } }>; total: number }> => {
    const response = await fetchWithInterceptor(`${USERS_BASE_PATH}/me/pricings?limit=${limit}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch accessible pricings');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const getUserAccessibleCollections = useCallback(async (limit = 500): Promise<{ collections: Array<{ name: string; permissions: { GET: boolean }; organization: { id: string; role: string } }>; total: number }> => {
    const response = await fetchWithInterceptor(`${USERS_BASE_PATH}/me/collections?limit=${limit}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch accessible collections');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const inviteUsers = useCallback(async (orgId: string, userIds: string[]): Promise<OrganizationInvitation> => {
    const response = await fetchWithInterceptor(`${ORGS_BASE_PATH}/${orgId}/invitations/invite-users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userIds }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Failed to invite users');
    return body as OrganizationInvitation;
  }, [fetchWithInterceptor, token]);

  return {
    getMyOrganizations,
    getOrganization,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    getOrgMembers,
    addMember,
    updateMemberRole,
    removeMember,
    listInvitations,
    createInvitation,
    revokeInvitation,
    previewInvitation,
    joinViaInvitation,
    lookupUserByUsername,
    getOrgChildren,
    getOrgPricings,
    getOrgCollections,
    getOrgPermissions,
    setOrgPermission,
    removeOrgPermission,
    getUserAccessiblePricings,
    getUserAccessibleCollections,
    inviteUsers,
    getPublicOrganization,
    getPublicOrgMembers,
  };
}

const BASE_URL = import.meta.env.VITE_API_URL;

export async function getPublicOrganization(orgId: string): Promise<Organization> {
  const response = await fetch(`${BASE_URL}/orgs/${orgId}`);
  if (!response.ok) throw new Error('Organization not found');
  return response.json();
}

export async function getPublicOrgMembers(orgId: string): Promise<OrgMemberWithUser[]> {
  const response = await fetch(`${BASE_URL}/orgs/${orgId}/members`);
  if (!response.ok) throw new Error('Failed to fetch members');
  return response.json();
}
