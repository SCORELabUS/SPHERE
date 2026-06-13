export interface Group {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  _organizationId: string;
  _parentGroupId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
