import { describe, expect, it } from 'vitest';
import { PermissionEngine } from '../../main/policies/PermissionEngine';
import { PermissionContext } from '../../main/types/policies';

const none = { GET: false, PUT: false, DELETE: false, CREATE: false };
const full = { GET: true, PUT: true, DELETE: true, CREATE: true };
const base: PermissionContext = { userId: 'member', organizationId: 'org', userOrgRole: 'MEMBER',
  entityType: 'pricing', entitySlug: 'pricing', action: 'PUT', isPrivate: true };

describe('PUT authority for pricings in collections', () => {
  const engine = new PermissionEngine();
  it('edits a contained pricing with collection GET/PUT and no individual permission', () => {
    expect(engine.evaluate({ ...base, collectionSlug: 'collection', collectionPermissions: full, entityPermissions: none }).allowed).toBe(true);
  });
  it('does not let individual PUT override a collection that denies PUT', () => {
    expect(engine.evaluate({ ...base, collectionSlug: 'collection', collectionPermissions: { ...none, GET: true }, entityPermissions: full }).allowed).toBe(false);
  });
  it('keeps individual PUT on a pricing outside collections', () => {
    expect(engine.evaluate({ ...base, entityPermissions: full }).allowed).toBe(true);
  });
  it('requires independent pricing PUT for a membership change', () => {
    expect(engine.evaluate({ ...base, collectionSlug: 'collection', collectionPermissions: full, entityPermissions: none,
      requireDirectPricingPut: true } as PermissionContext).allowed).toBe(false);
  });
});
