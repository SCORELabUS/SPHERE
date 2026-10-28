import { OrgUserPermissionsContext } from "../../../../types/policies";

export function considerUserCollectionPermissionsAggregator(permissions: OrgUserPermissionsContext) {

  if (permissions.isGlobalAdmin) {
    return { $match: {} };
  }

  const adminOrgMatch = permissions.adminOrgIds.length > 0
    ? [{ $expr: { $in: [{ $toString: '$_organizationId' }, permissions.adminOrgIds] } }]
    : [];

  // Being public lets a collection be seen, not edited: PUT needs an explicit
  // permission on it (see ENTITY_PUT), so public collections are not added here.
  if (permissions.writableOnly) {
    return {
      $match: {
        $or: [
          ...adminOrgMatch,
          {
            $expr: {
              $in: [
                { $concat: [{ $toString: '$_organizationId' }, ':', '$slug'] },
                permissions.collectionsWritable ?? [],
              ],
            },
          },
        ],
      },
    };
  }

  return {
      $match: {
        $or: [
          // El usuario es OWNER/ADMIN de la organización de la colección
          ...adminOrgMatch,

          // El slug de la colección está en las colecciones permitidas
          { 'slug': { $in: permissions.collections } },

          // La colección es pública
          // Missing `private` is the legacy public value for seeded/imported
          // collections created before the flag was persisted.
          { $or: [{ private: false }, { private: { $exists: false } }] }
        ],
      },
    };
}
