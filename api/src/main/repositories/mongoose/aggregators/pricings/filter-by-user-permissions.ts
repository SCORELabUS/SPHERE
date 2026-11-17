import { OrgUserPermissionsContext, UnlistedReaders } from "../../../../types/policies";

/**
 * A pricing anyone sees in a listing: its shown version is public and the
 * pricing is not unlisted (a missing value means listed).
 */
export const LISTED_PUBLIC = { private: false, unlisted: { $ne: true } };

/**
 * `unlistedReaders` adds the unlisted pricings with a public version that the
 * caller may read the private versions of, where `permissions` is not the
 * caller's own context (the global search keeps private versions as they are).
 */
export const considerUserPermissionsAggregator = (permissions: OrgUserPermissionsContext, unlistedReaders?: UnlistedReaders) => {
  return {
      $match: {
        $or: [
          // El usuario es OWNER/ADMIN de la organización del pricing
          ...(permissions.adminOrgIds.length > 0
            ? [{ $expr: { $in: [{ $toString: '$_organizationId' }, permissions.adminOrgIds] } }]
            : []),

          // El slug de la colección está en las colecciones permitidas (de la misma organización)
          { $expr: grantedByKey('$collection.slug', permissions.collectionKeys, permissions.collections) },

          // El pricing es público y aparece en los listados
          LISTED_PUBLIC,

          // Unlisted, pero el usuario puede leer sus versiones privadas (buscador global)
          ...(unlistedReaders
            ? [{
                private: false,
                unlisted: true,
                $or: [
                  { $expr: { $in: [{ $toString: '$_organizationId' }, unlistedReaders.adminOrgIds] } },
                  { $expr: grantedByKey('$collection.slug', unlistedReaders.collectionKeys, []) },
                  { $expr: grantedByKey('$slug', unlistedReaders.pricingKeys, []) },
                ],
              }]
            : []),

          // Está explícitamente en el array de slugs de pricings permitidos (de la misma organización)
          { $expr: grantedByKey('$slug', permissions.pricingKeys, permissions.pricings) },
        ],
      },
    };
};

/**
 * Whether the pricing's slug (or its collection's) is one the viewer holds GET
 * on. Slugs are only unique inside an organization, so the organization is
 * matched too when the context carries `organizationId:slug` keys.
 */
export function grantedByKey(slugField: string, keys: string[] | undefined, slugs: string[]): any {
  if (!keys) return { $in: [{ $ifNull: [slugField, null] }, slugs] };
  return {
    $in: [
      { $concat: [{ $toString: '$_organizationId' }, ':', { $ifNull: [slugField, ''] }] },
      keys,
    ],
  };
}
