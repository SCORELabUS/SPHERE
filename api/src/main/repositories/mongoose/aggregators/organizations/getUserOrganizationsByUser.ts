import mongoose, { PipelineStage } from 'mongoose';
import { OrganizationIndexByUserOptions } from '../../../../types/services/Organization';

/**
 * Builds a Mongoose aggregation pipeline that retrieves all organizations a user belongs to,
 * enriched with avatar data, role information, and optionally structured as a parent-child tree.
 *
 * @param userId - The ID of the user whose organizations to retrieve.
 * @param options - Configuration options for the query.
 * @param options.treeFormat - When `true` (default), organizations are nested into a tree
 *   structure where child organizations appear inside their parent's `subOrganizations` array.
 *   Only top-level organizations (those with no parent, or whose parent is not in the user's
 *   membership set) appear as root items. When `false`, returns a flat list of all organizations
 *   the user belongs to, each with its own `role` and `_parentId` field.
 * @param options.pagination - Optional pagination applied **after** the tree is built (tree mode)
 *   or directly on the flat list (flat mode). When provided, the return shape changes from an
 *   array to `{ items: Organization[], total: number }`.
 * @param options.pagination.limit - Maximum number of items to return per page. Defaults to 10.
 * @param options.pagination.offset - Number of items to skip from the start. Defaults to 0.
 * @returns A `PipelineStage[]` array that can be passed to `Mongoose.aggregate()`.
 *
 * @example
 * // Tree mode (default) — returns [{ id, name, subOrganizations: [...] }, ...]
 * getUserOrganizationsByUserAggregator(userId, { treeFormat: true });
 *
 * @example
 * // Flat mode — returns [{ id, name, role, _parentId }, ...]
 * getUserOrganizationsByUserAggregator(userId, { treeFormat: false });
 *
 * @example
 * // Paginated flat mode — returns { items: [...], total: number }
 * getUserOrganizationsByUserAggregator(userId, {
 *   treeFormat: false,
 *   pagination: { limit: 20, offset: 0 },
 * });
 */
export function getUserOrganizationsByUserAggregator(
  userId: string,
  options: OrganizationIndexByUserOptions
): PipelineStage[] {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const treeFormat = options.treeFormat ?? true;

  // ── Shared stages: fetch memberships, join orgs, deduplicate, enrich ──────
  const sharedPipeline: PipelineStage[] = [
    // 1. Match user's memberships
    { $match: { _userId: userObjectId } },

    // 2. Lookup organization data
    {
      $lookup: {
        from: 'organizations',
        localField: '_organizationId',
        foreignField: '_id',
        as: 'organization',
      },
    },
    { $unwind: '$organization' },

    // 3. Deduplicate: keep one membership per organization (highest-weighted role)
    {
      $sort: {
        _organizationId: 1,
        role: -1 as const,
      },
    },
    {
      $group: {
        _id: '$_organizationId',
        organization: { $first: '$organization' },
        role: { $first: '$role' },
      },
    },

    // 4. Add string IDs and convert types
    {
      $addFields: {
        id: { $toString: '$organization._id' },
        'organization.id': { $toString: '$organization._id' },
        'organization._parentId': {
          $cond: {
            if: { $ne: ['$organization._parentId', null] },
            then: { $toString: '$organization._parentId' },
            else: null,
          },
        },
        'organization.ancestors': {
          $map: {
            input: { $ifNull: ['$organization.ancestors', []] },
            as: 'a',
            in: { $toString: '$$a' },
          },
        },
      },
    },

    // 5. Lookup user data for personal org avatar/colors
    {
      $lookup: {
        from: 'users',
        pipeline: [
          { $match: { _id: userObjectId } },
          {
            $project: {
              avatar: '$settings.avatar',
              avatarBgColor: '$settings.avatarBgColor',
              avatarFgColor: '$settings.avatarFgColor',
            },
          },
        ],
        as: '_userData',
      },
    },
    { $unwind: { path: '$_userData', preserveNullAndEmptyArrays: true } },

    // 6. Set avatar colors and apply user avatar for personal orgs
    {
      $addFields: {
        'organization.avatar': {
          $cond: {
            if: {
              $and: [
                { $eq: ['$organization.isPersonal', true] },
                { $not: ['$organization.avatar'] },
                { $ne: ['$_userData.avatar', null] },
                { $ne: ['$_userData.avatar', ''] },
              ],
            },
            then: '$_userData.avatar',
            else: '$organization.avatar',
          },
        },
        'organization.avatarBgColor': {
          $cond: {
            if: { $eq: ['$organization.isPersonal', true] },
            then: { $ifNull: ['$_userData.avatarBgColor', '#fa520f'] },
            else: {
              $cond: {
                if: { $not: ['$organization.avatar'] },
                then: '#023e8a',
                else: { $ifNull: ['$organization.avatarBgColor', null] },
              },
            },
          },
        },
        'organization.avatarFgColor': {
          $cond: {
            if: { $eq: ['$organization.isPersonal', true] },
            then: { $ifNull: ['$_userData.avatarFgColor', '#ffffff'] },
            else: {
              $cond: {
                if: { $not: ['$organization.avatar'] },
                then: '#ffffff',
                else: { $ifNull: ['$organization.avatarFgColor', null] },
              },
            },
          },
        },
      },
    },
  ];

  // ── Flat mode stages ──────────────────────────────────────────────────────
  const flatPipeline: PipelineStage[] = [
    // Project the final shape for a flat list
    {
      $project: {
        _id: 0,
        id: 1,
        name: '$organization.name',
        displayName: '$organization.displayName',
        avatar: '$organization.avatar',
        isPersonal: '$organization.isPersonal',
        _parentId: '$organization._parentId',
        ancestors: '$organization.ancestors',
        avatarBgColor: '$organization.avatarBgColor',
        avatarFgColor: '$organization.avatarFgColor',
        role: 1,
      },
    },

    // Sort alphabetically by name
    { $sort: { name: 1 as const } },
  ];

  // ── Tree mode stages ──────────────────────────────────────────────────────
  const treePipeline: PipelineStage[] = [
    // 7. Lookup parent membership to determine top-level vs child
    {
      $lookup: {
        from: 'organizationMemberships',
        let: { parentId: '$organization._parentId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$_userId', userObjectId] },
                  { $ne: ['$$parentId', null] },
                  { $eq: ['$_organizationId', { $toObjectId: '$$parentId' }] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: '_parentMembership',
      },
    },

    // 8. Determine if this org is a child (parent exists in user's memberships)
    {
      $addFields: {
        _isChild: {
          $gt: [{ $size: '$_parentMembership' }, 0],
        },
      },
    },

    // 9. Sort by organization creation (oldest first so parents come before children)
    { $sort: { 'organization.createdAt': 1 as const } },

    // 10. Build child document inline (null for non-children)
    {
      $addFields: {
        _childDoc: {
          $cond: {
            if: '$_isChild',
            then: {
              id: '$organization.id',
              name: '$organization.name',
              displayName: '$organization.displayName',
              avatar: '$organization.avatar',
              isPersonal: '$organization.isPersonal',
              _parentId: '$organization._parentId',
              ancestors: '$organization.ancestors',
              avatarBgColor: '$organization.avatarBgColor',
              avatarFgColor: '$organization.avatarFgColor',
              role: '$role',
            },
            else: null,
          },
        },
        _topLevelDoc: {
          $cond: {
            if: { $not: '$_isChild' },
            then: '$organization',
            else: null,
          },
        },
      },
    },

    // 11. Group: top-level orgs collect their children
    {
      $group: {
        _id: {
          $cond: {
            if: '$_isChild',
            then: '$organization._parentId',
            else: '$organization.id',
          },
        },
        org: { $first: '$_topLevelDoc' },
        role: { $first: '$role' },
        _allChildDocs: { $push: '$_childDoc' },
      },
    },

    // 12. Filter top-level only (groups that have a top-level org)
    { $match: { org: { $ne: null } } },

    // 13. Reshape: filter out nulls from children and clean up
    {
      $addFields: {
        id: '$org.id',
        name: '$org.name',
        displayName: '$org.displayName',
        avatar: '$org.avatar',
        isPersonal: '$org.isPersonal',
        _parentId: '$org._parentId',
        ancestors: '$org.ancestors',
        avatarBgColor: '$org.avatarBgColor',
        avatarFgColor: '$org.avatarFgColor',
        subOrganizations: {
          $filter: {
            input: '$_allChildDocs',
            as: 'c',
            cond: { $ne: ['$$c', null] },
          },
        },
      },
    },

    // 14. Clean up temp fields
    {
      $project: {
        _id: 0,
        org: 0,
        _allChildDocs: 0,
      },
    },

    // 15. Sort final results (alphabetical by name)
    { $sort: { name: 1 as const } },
  ];

  // ── Assemble pipeline ─────────────────────────────────────────────────────
  const basePipeline: PipelineStage[] = [
    ...sharedPipeline,
    ...(treeFormat ? treePipeline : flatPipeline),
  ];

  // ── Pagination (optional, applied last) ───────────────────────────────────
  if (
    options.pagination &&
    (typeof options.pagination.limit !== 'undefined' || typeof options.pagination.offset !== 'undefined')
  ) {
    const offset = options.pagination.offset ?? 0;
    const limit = options.pagination.limit ?? 10;

    basePipeline.push({
      $facet: {
        items: [{ $skip: offset }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    });
  }

  return basePipeline;
}
