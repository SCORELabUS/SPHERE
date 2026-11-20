/** Organization visibility is the first gate, before collection and pricing permissions. */
export async function canReadOrganization(organizationId: string, user?: any, authType?: string): Promise<boolean> {
  const { default: container } = await import('../config/container');
  const organization = await container.resolve<any>('organizationRepository').findById(organizationId);
  if (!organization) return false;
  if (organization.visibility !== 'private') return true;
  if (!user) return false;
  const access = await container.resolve<any>('permissionService').actingAccess(user, organizationId, authType);
  return access.reachable && Boolean(access.role || access.isGlobalAdmin);
}

export async function assertOrganizationReadable(organizationId: string, user?: any, authType?: string): Promise<void> {
  if (!await canReadOrganization(organizationId, user, authType)) throw new Error('NOT FOUND: Organization not found');
}

/** Bound user-owned listings to the organizations the credential can reach. */
export async function scopeOrganizationIds(user: any, ids: string[]): Promise<string[]> {
  if (!user?.apiKey) return ids;
  const { default: container } = await import('../config/container');
  const permissions = container.resolve<any>('permissionService');
  const allowed = await Promise.all(ids.map(async id => {
    const access = await permissions.actingAccess(user, id);
    return access.reachable && Boolean(access.role) ? id : null;
  }));
  return allowed.filter((id): id is string => id !== null);
}

/** A pricing cannot be read when its organization or its containing collection is hidden. */
export async function canReadPricingParents(organizationId: string, collectionId: unknown, user?: any, authType?: string): Promise<boolean> {
  if (!await canReadOrganization(organizationId, user, authType)) return false;
  if (!collectionId) return true;
  const { default: container } = await import('../config/container');
  const collection = await container.resolve<any>('pricingCollectionService').findRef(String(collectionId));
  if (!collection || collection.organizationId !== organizationId) return false;
  return container.resolve<any>('permissionService').canViewCollection(user, collection);
}
