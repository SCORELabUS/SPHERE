import { OrgUserPermissionsContext } from "../../../../types/policies";

export const considerUserPermissionsAggregator = (permissions: OrgUserPermissionsContext) => {
  return {
      $match: {
        $or: [
          // El usuario es OWNER/ADMIN de la organización del pricing
          ...(permissions.adminOrgIds.length > 0
            ? [{ $expr: { $in: [{ $toString: '$_organizationId' }, permissions.adminOrgIds] } }]
            : []),

          // El slug de la colección está en las colecciones permitidas (de la misma organización)
          { $expr: grantedByKey('$collection.slug', permissions.collectionKeys, permissions.collections) },

          // El pricing es público
          { private: false },

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
