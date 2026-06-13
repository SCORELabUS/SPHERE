import { OrgRole } from "../models/Organization";

export type UserRole = 'ADMIN' | 'USER';

export const USER_ROLES: UserRole[] = ['ADMIN', 'USER'];
export const ORGANIZATION_ROLES: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER'];