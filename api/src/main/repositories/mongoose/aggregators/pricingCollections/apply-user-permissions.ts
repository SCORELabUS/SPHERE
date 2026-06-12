import { OrgUserPermissionsContext } from "../../../../types/policies";

export function considerUserCollectionPermissionsAggregator(permissions: OrgUserPermissionsContext) {
  
  if (permissions.isGlobalAdmin) {
    return { $match: {} }; 
  }

  return {
      $match: {
        $or: [
          // El usuario es OWNER/ADMIN de la organización de la colección
          ...(permissions.adminOrgIds.length > 0
            ? [{ $expr: { $in: [{ $toString: '$_organizationId' }, permissions.adminOrgIds] } }]
            : []),

          // El slug de la colección está en las colecciones permitidas
          { 'slug': { $in: permissions.collections } },

          // La colección es pública
          { private: false }
        ],
      },
    };
}