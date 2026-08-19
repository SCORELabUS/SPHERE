export type EntityType = 'pricing' | 'collection';
export type PermissionType = 'GET' | 'PUT' | 'DELETE' | 'CREATE';

export interface EntityPermissions {
  GET: boolean;
  PUT: boolean;
  DELETE: boolean;
  CREATE: boolean;
}

export interface EntityPermission {
  id: string;
  _userId: string;
  _organizationId: string;
  entityType: EntityType;
  entitySlug: string | null;
  permissions: EntityPermissions;
  grantedBy?: string;
  entityName?: string;
  userName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SetPermissionPayload {
  userId: string;
  entityType: EntityType;
  entitySlug: string | null;
  permissions: EntityPermissions;
}

export interface BulkSetPermissionsPayload {
  permissions: SetPermissionPayload[];
  removePermissionIds: string[];
}

export interface BulkSetPermissionsResult {
  created: number;
  updated: number;
  deleted: number;
  permissions: EntityPermission[];
}
