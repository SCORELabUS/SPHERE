export type EntityType = 'pricing' | 'collection';
export type PermissionType = 'GET' | 'PUT' | 'DELETE' | 'CREATE';

export interface EntityPermissions {
  GET: boolean;
  PUT: boolean;
  DELETE: boolean;
  CREATE: boolean;
}

export interface LeanEntityPermission {
  id: string;
  _userId: string;
  _organizationId: string;
  entityType: EntityType;
  entitySlug: string | null;
  permissions: EntityPermissions;
  grantedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SetEntityPermissionInput {
  userId: string;
  entityType: EntityType;
  entitySlug: string | null;
  permissions: Partial<EntityPermissions>;
}

export interface BulkSetEntityPermissionsResult {
  created: number;
  updated: number;
  permissions: LeanEntityPermission[];
}
