export interface OrganizationMembership {
  id: string;
  _userId: string;
  _organizationId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}
