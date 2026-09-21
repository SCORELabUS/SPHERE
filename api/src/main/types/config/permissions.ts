import { OrgRole } from "../models/Organization";

export type UserRole = 'ADMIN' | 'USER';

export const USER_ROLES: UserRole[] = ['ADMIN', 'USER'];
export const ORGANIZATION_ROLES: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER'];
export const ASSIGNABLE_ORGANIZATION_ROLES: OrgRole[] = ['ADMIN', 'MEMBER'];
export const SINGLE_OWNER_NOTE =
  'An organization has a single owner, which is handed over to another member rather than assigned';
