import mongoose from "mongoose";

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export const ROLE_WEIGHT = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

export interface LeanOrganization {
  id?: string;
  name: string;
  displayName: string;
  description: string | null;
  avatar: string;
  _parentId: mongoose.Types.ObjectId | null;
  ancestors: string[];
  subOrganizations?: LeanOrganization[];
  isPersonal: boolean;
}

export interface LeanMembership {
  id?: string;
  _userId: string;
  _organizationId: string;
  role: OrgRole;
  joinedAt: Date;
}