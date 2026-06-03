import { OrgUserPermissionsContext } from "../../../../types/policies";

export const considerUserPermissionsAggregator = (permissions: OrgUserPermissionsContext) => {
  return {
      $match: {
        $or: [
          // El usuario es OWNER/ADMIN de la organización del pricing
          ...(permissions.adminOrgIds.length > 0
            ? [{ $expr: { $in: [{ $toString: '$_organizationId' }, permissions.adminOrgIds] } }]
            : []),

          // El slug de la colección está en las colecciones permitidas
          { 'collection.slug': { $in: permissions.collections } },

          // El pricing es público
          { private: false },

          // Está explícitamente en el array de slugs de pricings permitidos
          { slug: { $in: permissions.pricings } },
        ],
      },
    };
} ;