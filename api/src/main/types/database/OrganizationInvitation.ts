export interface OrganizationInvitation {
  id: string;
  _organizationId: string;
  code: string;
  createdBy: string;
  expiresAt?: Date | null;
  maxUses?: number | null;
  useCount: number;
  createdAt: Date;
}
