import { OrgUserPermissionsContext } from "../../../../types/policies";

export function considerUserCollectionPermissionsAggregator(permissions: OrgUserPermissionsContext) {
  
  if (permissions.orgRole === 'ADMIN' || permissions.orgRole === 'OWNER') {
    return { $match: {} }; 
  }

  return {
      $match: {
        $or: [
          // Condición 1: El ID de la colección está en las colecciones permitidas.
          { 'id': { $in: permissions.collections } },

          // Condición 2: La colección es pública
          { private: false }
        ],
      },
    };
}