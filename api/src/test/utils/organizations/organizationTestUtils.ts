import request from 'supertest';
import mongoose from 'mongoose';
import testContainer from '../config/testContainer';
import { BASE_PATH } from '../config/variables';
import OrganizationMongoose from '../../../main/repositories/mongoose/models/OrganizationMongoose';
import OrganizationMembershipMongoose from '../../../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import OrganizationInvitationMongoose from '../../../main/repositories/mongoose/models/OrganizationInvitationMongoose';
import EntityPermissionMongoose from '../../../main/repositories/mongoose/models/EntityPermissionMongoose';
import { randomSuffix, createGlobalTestUser } from '../helpers';
import type { TestApp } from '../testApp';
import { LeanMembership } from '../../../main/types/models/Organization';
import { EntityType, EntityPermissions } from '../../../main/types/models/EntityPermission';

export type TestOrganizationData = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  avatar?: string | null;
  isPersonal: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TestMembershipData = {
  id: string;
  _userId: string;
  _organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joinedAt: Date;
  user?: {
    id: string;
    username: string;
    email: string;
    avatar: string | null;
  };
};

export type TestInvitationData = {
  id: string;
  code: string;
  expiresAt?: Date | null;
  maxUses?: number | null;
  useCount: number;
  createdAt: Date;
};

export const createTestOrganization = async (
  ownerToken: string,
  orgData: Partial<{
    name: string;
    displayName: string;
    description: string | null;
    avatarUrl: string | null;
    isPersonal: boolean;
    _parentId: string | null;
  }> = {}
): Promise<TestOrganizationData> => {
  const name = orgData.name || `test_org_${randomSuffix()}`;
  const displayName = orgData.displayName || `Test Org ${randomSuffix()}`;
  const isPersonal = orgData.isPersonal ?? false;
  const parentId = orgData._parentId ?? null;

  const payload: any = {
    name: isPersonal ? undefined : name,
    displayName,
    isPersonal,
  };

  if (parentId != null) {
    payload._parentId = parentId;
  }

  if (orgData.description != null) {
    payload.description = orgData.description;
  }
  if (orgData.avatarUrl != null) {
    payload.avatarUrl = orgData.avatarUrl;
  }

  const app = testContainer.resolve<TestApp>('app');
  const response = await request(app)
    .post(`${BASE_PATH}/orgs`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send(payload);

  if (response.status !== 201) {
    throw new Error(`Failed to create organization: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const org = response.body as TestOrganizationData;
  testContainer.resolve('orgsToDelete').add(org.id);

  return org;
};

export const createTestOrganizationDirect = async (
  orgData: Partial<{
    name: string;
    displayName: string;
    description: string | null;
    avatar: string | null;
    isPersonal: boolean;
    ancestors: string[];
    _parentId: string | null;
  }> = {}
): Promise<TestOrganizationData> => {
  const name = orgData.name || `test_org_${randomSuffix()}`;
  const displayName = orgData.displayName || `Test Org ${randomSuffix()}`;

  const org = new OrganizationMongoose({
    name,
    displayName,
    description: orgData.description ?? null,
    avatar: orgData.avatar ?? null,
    isPersonal: orgData.isPersonal ?? false,
    ancestors: orgData.ancestors ?? [],
    _parentId: orgData._parentId ?? null,
  });

  const saved = await org.save();

  if (!saved) {
    throw new Error('Failed to create organization');
  }

  testContainer.resolve('orgsToDelete').add(saved._id.toString());

  return {
    id: saved._id.toString(),
    name: name,
    displayName: displayName,
    description: orgData.description ?? undefined,
    avatar: orgData.avatar ?? undefined,
    isPersonal: orgData.isPersonal ?? false,
    createdAt: (saved as any).createdAt,
    updatedAt: (saved as any).updatedAt,
  };
};

export const createMembership = async (
  userId: string,
  organizationId: string,
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
): Promise<LeanMembership> => {
  const joinedAt = new Date();

  const membership = new OrganizationMembershipMongoose({
    _userId: new mongoose.Types.ObjectId(userId),
    _organizationId: new mongoose.Types.ObjectId(organizationId),
    role,
    joinedAt: joinedAt,
  });

  const saved = await membership.save();

  if (!saved) {
    throw new Error('Failed to create organization membership');
  }

  testContainer.resolve('membershipsToDelete').add(saved._id.toString());

  return {
    id: saved._id.toString(),
    _userId: saved._userId!.toString(),
    _organizationId: saved._organizationId!.toString(),
    role: saved.role as 'OWNER' | 'ADMIN' | 'MEMBER',
    joinedAt: joinedAt,
  };
};

export const createTestInvitation = async (
  organizationId: string,
  creatorUserId: string,
  options: Partial<{
    expiresInDays: number;
    maxUses: number | null;
  }> = {}
): Promise<TestInvitationData> => {
  const code = randomSuffix() + randomSuffix();
  const expiresInDays = options.expiresInDays ?? 7;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const invitation = new OrganizationInvitationMongoose({
    _organizationId: organizationId,
    code,
    createdBy: creatorUserId,
    expiresAt: expiresAt,
    maxUses: options.maxUses ?? null,
    useCount: 0,
  });

  const saved = await invitation.save();

  if (!saved) {
    throw new Error('Failed to create organization invitation');
  }

  testContainer.resolve('invitationsToDelete').add(saved._id.toString());

  return {
    id: saved._id.toString(),
    code: code,
    expiresAt: expiresAt ?? undefined,
    maxUses: options.maxUses ?? undefined,
    useCount: 0,
    createdAt: (saved as any).createdAt,
  };
};

export const createOrgWithOwnerAndMembers = async (
  ownerToken: string,
  ownerId: string,
  memberTokens: string[] = []
): Promise<{
  organization: TestOrganizationData;
  owner: { id: string; token: string };
  members: Array<{ id: string; token: string }>;
}> => {
  const org = await createTestOrganization(ownerToken);

  const members = [];
  for (const token of memberTokens) {
    const user = await createGlobalTestUser();
    members.push({ id: user.id, token });
    await createMembership(user.id, org.id, 'MEMBER');
  }

  return {
    organization: org,
    owner: { id: ownerId, token: ownerToken },
    members,
  };
};

export const cleanupOrganization = async (organizationId: string): Promise<void> => {
  try {
    await OrganizationMembershipMongoose.deleteMany({ _organizationId: organizationId });
    await OrganizationInvitationMongoose.deleteMany({ _organizationId: organizationId });
    await OrganizationMongoose.deleteOne({ _id: organizationId });
  } catch (error) {
    console.error(`Failed to cleanup organization ${organizationId}:`, error);
  }
};

/**
 * Creates an org-scoped EntityPermission (entityId=null) for a user.
 * Used to grant/revoke CREATE permissions at the organization level.
 */
export const createOrgScopedPermission = async (
  userId: string,
  organizationId: string,
  entityType: EntityType,
  permissions: EntityPermissions
): Promise<void> => {
  const permission = new EntityPermissionMongoose({
    _userId: new mongoose.Types.ObjectId(userId),
    _organizationId: new mongoose.Types.ObjectId(organizationId),
    entityType,
    entitySlug: null,
    permissions,
  });

  const saved = await permission.save();
  if (!saved) {
    throw new Error('Failed to create org-scoped permission');
  }
};

/**
 * Creates an entity-scoped EntityPermission (entityId=null) for a user.
 * Used to grant/revoke CREATE permissions at the organization level.
 */
export const createEntityScopedPermission = async (
  userId: string,
  organizationId: string,
  entityId: string,
  entityType: EntityType,
  permissions: EntityPermissions
): Promise<void> => {
  const permission = new EntityPermissionMongoose({
    _userId: new mongoose.Types.ObjectId(userId),
    _organizationId: new mongoose.Types.ObjectId(organizationId),
    entityType,
    entitySlug: entityId,
    permissions,
  });

  const saved = await permission.save();
  if (!saved) {
    throw new Error('Failed to create entity-scoped permission');
  }
};