import { OrgUserPermissionsContext } from "../../../../types/policies";

export const considerUserPermissionsAggregator = (permissions: OrgUserPermissionsContext) => {
  return {
      $match: {
        $or: [
          // Condición 1: El ID de la colección está en las colecciones permitidas.
          // Ojo: en tu pipeline haces { $toString: '$collection._id' }, por lo que
          // 'collection.id' es un string. Asumimos que permissions.collections son strings.
          { 'collection.id': { $in: permissions.collections } },

          // Condición 2: El pricing es público
          { private: false },

          // Condición 3: Está explícitamente en el array de pricings permitidos
          { id: { $in: permissions.pricings } },
        ],
      },
    };
} ;