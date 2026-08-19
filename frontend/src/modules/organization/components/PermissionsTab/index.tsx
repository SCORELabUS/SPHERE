import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Iconify from '../../../core/components/iconify';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import customAlert from '../../../core/utils/custom-alert';
import {
  useOrganizationsApi,
  OrgMemberWithUser,
  OrgPricing,
  OrgCollection,
} from '../../api/organizationsApi';
import {
  EntityPermission,
  EntityPermissions,
  EntityType,
  PermissionType,
  SetPermissionPayload,
} from '../../types/permissions';

interface PermissionsTabProps {
  organizationId: string;
  canManage: boolean;
}

const PERMISSION_LABELS: Record<'GET' | 'CREATE' | 'PUT' | 'DELETE', string> = {
  GET: 'Read',
  CREATE: 'Create',
  PUT: 'Edit',
  DELETE: 'Delete',
};

const PERMISSION_COLORS: Record<'GET' | 'CREATE' | 'PUT' | 'DELETE', string> = {
  GET: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  CREATE: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  PUT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const ROLE_BADGE: Record<string, string> = {
  OWNER: 'bg-tp-primary/10 text-tp-primary',
  ADMIN: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  MEMBER: 'bg-tp-surface text-tp-steel',
};

const EMPTY_PERMISSIONS: EntityPermissions = {
  GET: false,
  CREATE: false,
  PUT: false,
  DELETE: false,
};

const permissionTarget = (
  permission: Pick<EntityPermission, '_userId' | 'entityType' | 'entitySlug'>
) => `${permission._userId}:${permission.entityType}:${permission.entitySlug ?? ''}`;

const clonePermissions = (permissions: EntityPermission[]) =>
  permissions.map(permission => ({
    ...permission,
    permissions: { ...permission.permissions },
  }));

const permissionsMatch = (left: EntityPermissions, right: EntityPermissions) =>
  (Object.keys(EMPTY_PERMISSIONS) as PermissionType[]).every(
    permission => left[permission] === right[permission]
  );

export default function PermissionsTab({ organizationId, canManage }: PermissionsTabProps) {
  const {
    getOrgMembers,
    getOrgPermissions,
    getOrgPricings,
    getOrgCollections,
    setOrgPermissionsBulk,
  } = useOrganizationsApi();

  const [members, setMembers] = useState<OrgMemberWithUser[]>([]);
  const [permissions, setPermissions] = useState<EntityPermission[]>([]);
  const [draftPermissions, setDraftPermissions] = useState<EntityPermission[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [entityTab, setEntityTab] = useState<EntityType>('pricing');
  const [memberSearch, setMemberSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [pricings, setPricings] = useState<OrgPricing[]>([]);
  const [collections, setCollections] = useState<OrgCollection[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addPermissions, setAddPermissions] = useState<{
    GET: boolean;
    CREATE: boolean;
    PUT: boolean;
    DELETE: boolean;
  }>({ GET: true, CREATE: false, PUT: false, DELETE: false });
  const [isSaving, setIsSaving] = useState(false);

  const getOrgPricingsRef = useRef(getOrgPricings);
  getOrgPricingsRef.current = getOrgPricings;
  const getOrgCollectionsRef = useRef(getOrgCollections);
  getOrgCollectionsRef.current = getOrgCollections;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [membersData, permissionsData] = await Promise.all([
        getOrgMembers(organizationId),
        getOrgPermissions(organizationId),
      ]);
      setMembers(membersData);
      const nextPermissions = clonePermissions(permissionsData);
      setPermissions(nextPermissions);
      setDraftPermissions(clonePermissions(nextPermissions));
      if (!selectedMemberId && membersData.length > 0) {
        setSelectedMemberId(membersData[0].user.id);
      }
    } catch (err: any) {
      customAlert(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!showAddModal) return;
    (async () => {
      try {
        const [pricingData, collectionData] = await Promise.all([
          getOrgPricingsRef.current(organizationId, { limit: '200' }),
          getOrgCollectionsRef.current(organizationId, { limit: '200' }),
        ]);
        setPricings(pricingData.pricings);
        setCollections(collectionData.collections);
      } catch (err: any) {
        customAlert(err.message, 'error');
      }
    })();
  }, [showAddModal, organizationId]);

  const selectedMember = useMemo(
    () => members.find(m => m.user.id === selectedMemberId) ?? null,
    [members, selectedMemberId]
  );

  const isOwnerOrAdmin = selectedMember?.role === 'OWNER' || selectedMember?.role === 'ADMIN';

  const memberPermissions = useMemo(
    () => draftPermissions.filter(p => p._userId === selectedMemberId),
    [draftPermissions, selectedMemberId]
  );

  const orgScopedPermissions = useMemo(
    () => memberPermissions.filter(p => p.entitySlug === null),
    [memberPermissions]
  );

  const entityScopedPermissions = useMemo(
    () => memberPermissions.filter(p => p.entitySlug !== null && p.entityType === entityTab),
    [memberPermissions, entityTab]
  );

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return members;
    const q = memberSearch.toLowerCase();
    return members.filter(
      m =>
        m.user.username.toLowerCase().includes(q) ||
        m.user.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  const availableEntities = useMemo(() => {
    const existingSlugs = new Set(entityScopedPermissions.map(p => p.entitySlug));
    const entities =
      entityTab === 'pricing'
        ? pricings.map(p => ({
            slug: p.slug,
            label: p.name,
            sub: p.collection?.name ?? 'No collection',
          }))
        : collections.map(c => ({
            slug: c.slug,
            label: c.name,
            sub: `${c.numberOfPricings} pricings`,
          }));
    return entities
      .filter(e => !existingSlugs.has(e.slug))
      .filter(e => {
        if (!addSearch.trim()) return true;
        return e.label.toLowerCase().includes(addSearch.toLowerCase());
      });
  }, [entityTab, pricings, collections, entityScopedPermissions, addSearch]);

  const persistedPermissionsByTarget = useMemo(
    () => new Map(permissions.map(permission => [permissionTarget(permission), permission])),
    [permissions]
  );

  const { pendingUpserts, pendingRemovalIds } = useMemo(() => {
    const draftByTarget = new Map(
      draftPermissions.map(permission => [permissionTarget(permission), permission])
    );

    const upserts: SetPermissionPayload[] = [];
    draftByTarget.forEach((draft, target) => {
      const persisted = persistedPermissionsByTarget.get(target);
      if (!persisted || !permissionsMatch(persisted.permissions, draft.permissions)) {
        upserts.push({
          userId: draft._userId,
          entityType: draft.entityType,
          entitySlug: draft.entitySlug,
          permissions: { ...draft.permissions },
        });
      }
    });

    const removals = permissions.flatMap(permission =>
      permission.id && !draftByTarget.has(permissionTarget(permission)) ? [permission.id] : []
    );

    return { pendingUpserts: upserts, pendingRemovalIds: removals };
  }, [draftPermissions, permissions, persistedPermissionsByTarget]);

  const pendingChangeCount = pendingUpserts.length + pendingRemovalIds.length;

  const handleToggleOrgPermission = useCallback(
    (targetType: EntityType) => {
      if (!canManage || !selectedMemberId || isOwnerOrAdmin) return;

      const existing = orgScopedPermissions.find(p => p.entityType === targetType);
      const target = existing ? permissionTarget(existing) : `${selectedMemberId}:${targetType}:`;

      setDraftPermissions(previous => {
        const index = previous.findIndex(permission => permissionTarget(permission) === target);
        if (index >= 0) {
          return previous.map((permission, permissionIndex) =>
            permissionIndex === index
              ? {
                  ...permission,
                  permissions: {
                    ...permission.permissions,
                    CREATE: !permission.permissions.CREATE,
                  },
                }
              : permission
          );
        }

        return [
          ...previous,
          {
            id: `draft:${target}`,
            _userId: selectedMemberId,
            _organizationId: organizationId,
            entityType: targetType,
            entitySlug: null,
            permissions: { ...EMPTY_PERMISSIONS, CREATE: true },
          },
        ];
      });
    },
    [canManage, selectedMemberId, isOwnerOrAdmin, orgScopedPermissions, organizationId]
  );

  const handleToggleEntityPermission = useCallback(
    (permType: PermissionType, permission: EntityPermission) => {
      if (!canManage || isOwnerOrAdmin) return;

      const target = permissionTarget(permission);
      setDraftPermissions(previous =>
        previous.map(item =>
          permissionTarget(item) === target
            ? {
                ...item,
                permissions: {
                  ...item.permissions,
                  [permType]: !item.permissions[permType],
                },
              }
            : item
        )
      );
    },
    [canManage, isOwnerOrAdmin]
  );

  const handleRemovePermission = useCallback(
    (permission: EntityPermission) => {
      if (!canManage) return;
      const target = permissionTarget(permission);
      setDraftPermissions(previous => previous.filter(item => permissionTarget(item) !== target));
    },
    [canManage]
  );

  const handleAddPermission = useCallback(
    (entitySlug: string) => {
      if (!canManage || !selectedMemberId) return;
      const target = `${selectedMemberId}:${entityTab}:${entitySlug}`;
      const entity = availableEntities.find(item => item.slug === entitySlug);
      setDraftPermissions(previous => [
        ...previous,
        {
          id: `draft:${target}`,
          _userId: selectedMemberId,
          _organizationId: organizationId,
          entityType: entityTab,
          entitySlug,
          entityName: entity?.label,
          permissions: { ...addPermissions },
        },
      ]);
      setShowAddModal(false);
      setAddSearch('');
      setAddPermissions({ GET: true, PUT: false, DELETE: false, CREATE: false });
    },
    [canManage, selectedMemberId, organizationId, entityTab, addPermissions, availableEntities]
  );

  const handleDiscardChanges = useCallback(() => {
    setDraftPermissions(clonePermissions(permissions));
  }, [permissions]);

  const handleSaveChanges = useCallback(async () => {
    if (!canManage || pendingChangeCount === 0 || isSaving) return;

    setIsSaving(true);
    try {
      const result = await setOrgPermissionsBulk(organizationId, {
        permissions: pendingUpserts,
        removePermissionIds: pendingRemovalIds,
      });
      const savedByTarget = new Map(
        result.permissions.map(permission => [permissionTarget(permission), permission])
      );
      const savedPermissions = draftPermissions.map(permission => {
        const saved = savedByTarget.get(permissionTarget(permission));
        return saved
          ? { ...permission, ...saved, entityName: permission.entityName }
          : { ...permission, permissions: { ...permission.permissions } };
      });

      setPermissions(clonePermissions(savedPermissions));
      setDraftPermissions(clonePermissions(savedPermissions));
      customAlert(
        `${pendingChangeCount} permission change${pendingChangeCount === 1 ? '' : 's'} saved successfully.`,
        'success'
      );
    } catch (err: any) {
      customAlert(err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [
    canManage,
    draftPermissions,
    isSaving,
    organizationId,
    pendingChangeCount,
    pendingRemovalIds,
    pendingUpserts,
    setOrgPermissionsBulk,
  ]);

  return (
    <div className="rounded-xl border border-tp-hairline bg-tp-canvas">
      <div className="flex flex-col gap-3 border-b border-tp-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg text-tp-ink">Entity Permissions</h2>
          <p className="text-xs text-tp-steel">
            Configure which pricings and collections each member can access.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDiscardChanges}
              disabled={pendingChangeCount === 0 || isSaving}
              className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-xs font-medium text-tp-steel transition-colors hover:border-tp-primary hover:text-tp-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={handleSaveChanges}
              disabled={pendingChangeCount === 0 || isSaving}
              title={
                pendingChangeCount === 0
                  ? 'Change one or more permissions to enable saving'
                  : `Save ${pendingChangeCount} permission change${pendingChangeCount === 1 ? '' : 's'}`
              }
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-sm font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Iconify
                icon={isSaving ? 'mdi:loading' : 'mdi:content-save-outline'}
                width={16}
                className={isSaving ? 'animate-spin' : ''}
              />
              {isSaving
                ? 'Saving...'
                : `Save changes${pendingChangeCount > 0 ? ` (${pendingChangeCount})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {canManage && pendingChangeCount > 0 && (
        <div className="flex items-center gap-2 border-b border-tp-primary/20 bg-tp-primary/5 px-5 py-2.5 text-xs text-tp-ink">
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-tp-primary px-1.5 font-semibold text-tp-on-primary">
            {pendingChangeCount}
          </span>
          <span>
            Unsaved permission change{pendingChangeCount === 1 ? '' : 's'} across your draft.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-b-tp-primary" />
        </div>
      ) : (
        <div className="flex min-h-125">
          {/* ── Member sidebar ── */}
          <div className="w-64 shrink-0 border-r border-tp-hairline">
            <div className="border-b border-tp-hairline p-3">
              <input
                type="text"
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                placeholder="Search members..."
                className="h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none"
              />
            </div>
            <div className="divide-y divide-tp-hairline overflow-y-auto" style={{ maxHeight: 460 }}>
              {filteredMembers.length === 0 && (
                <div className="py-8 text-center text-xs text-tp-steel">No members found.</div>
              )}
              {filteredMembers.map(member => (
                <button
                  key={member.user.id}
                  type="button"
                  onClick={() => setSelectedMemberId(member.user.id)}
                  className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    selectedMemberId === member.user.id
                      ? 'bg-tp-primary/8'
                      : 'hover:bg-tp-surface/60'
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tp-cream text-xs font-semibold text-tp-primary">
                    {member.user.username[0]?.toUpperCase() ?? 'U'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-tp-ink">
                      @{member.user.username}
                    </p>
                    <p className="truncate text-[11px] text-tp-steel">{member.user.email}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_BADGE[member.role] ?? ''}`}
                  >
                    {member.role}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Permissions panel ── */}
          <div className="flex-1 overflow-y-auto">
            {!selectedMember ? (
              <div className="flex flex-col items-center justify-center py-16 text-tp-steel">
                <Iconify icon="mdi:account-outline" width={32} />
                <p className="mt-2 text-sm">Select a member to manage their permissions.</p>
              </div>
            ) : isOwnerOrAdmin ? (
              <div className="p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tp-cream text-sm font-semibold text-tp-primary">
                    {selectedMember.user.username[0]?.toUpperCase() ?? 'U'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-tp-ink">
                      @{selectedMember.user.username}
                    </p>
                    <p className="text-[11px] text-tp-steel">{selectedMember.user.email}</p>
                  </div>
                  <span
                    className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ROLE_BADGE[selectedMember.role] ?? ''}`}
                  >
                    {selectedMember.role}
                  </span>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-sphere-primary-200 bg-tp-primary/8 px-4 py-3">
                  <Iconify icon="mdi:shield-check-outline" width={20} className="text-tp-primary" />
                  <p className="text-sm text-tp-ink">
                    <span className="font-semibold">{selectedMember.role}</span> users have full
                    access to all pricings and collections in this organization. No granular
                    permissions needed.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-5">
                {/* Member header */}
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tp-cream text-sm font-semibold text-tp-primary">
                    {selectedMember.user.username[0]?.toUpperCase() ?? 'U'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-tp-ink">
                      @{selectedMember.user.username}
                    </p>
                    <p className="text-[11px] text-tp-steel">{selectedMember.user.email}</p>
                  </div>
                  <span
                    className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ROLE_BADGE[selectedMember.role] ?? ''}`}
                  >
                    {selectedMember.role}
                  </span>
                </div>

                {/* ── Org-scoped CREATE permissions ── */}
                <div className="mb-6">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tp-steel">
                    Organization-level
                  </h3>
                  <p className="mb-3 text-[11px] text-tp-muted">
                    Grants the ability to create new pricings or collections in this organization.
                  </p>
                  <div className="flex gap-3">
                    {(['pricing', 'collection'] as EntityType[]).map(type => {
                      const orgPerm = orgScopedPermissions.find(p => p.entityType === type);
                      const isOn = orgPerm?.permissions.CREATE ?? false;
                      const persisted = orgPerm
                        ? persistedPermissionsByTarget.get(permissionTarget(orgPerm))
                        : undefined;
                      const isPending = orgPerm
                        ? !persisted ||
                          !permissionsMatch(persisted.permissions, orgPerm.permissions)
                        : false;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => handleToggleOrgPermission(type)}
                          disabled={!canManage || isSaving}
                          className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                            isOn
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                              : 'border-tp-hairline-strong bg-tp-surface text-tp-slate hover:bg-tp-canvas'
                          } ${isPending ? 'ring-2 ring-tp-primary/20' : ''}`}
                        >
                          <Iconify
                            icon={isOn ? 'mdi:check-circle-outline' : 'mdi:plus-circle-outline'}
                            width={16}
                          />
                          {type === 'pricing' ? 'Pricing CREATE' : 'Collection CREATE'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Entity-scoped permissions ── */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-tp-steel">
                      Entity-level
                    </h3>
                    <div className="flex gap-1 rounded-lg border border-tp-hairline bg-tp-surface p-0.5">
                      {(['pricing', 'collection'] as EntityType[]).map(type => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setEntityTab(type)}
                          className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                            entityTab === type
                              ? 'bg-tp-canvas text-tp-ink shadow-sm'
                              : 'text-tp-steel hover:text-tp-ink'
                          }`}
                        >
                          {type === 'pricing' ? 'Pricings' : 'Collections'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {entityScopedPermissions.length === 0 ? (
                    <div className="rounded-lg border border-tp-hairline bg-tp-surface/50 py-8 text-center">
                      <Iconify
                        icon="mdi:shield-lock-outline"
                        width={28}
                        className="mx-auto text-tp-muted"
                      />
                      <p className="mt-2 text-xs text-tp-steel">
                        No {entityTab} permissions configured yet.
                      </p>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddModal(true);
                            setAddSearch('');
                            setAddPermissions({
                              GET: true,
                              PUT: false,
                              DELETE: false,
                              CREATE: false,
                            });
                          }}
                          className="mt-3 flex cursor-pointer items-center gap-1 mx-auto rounded-lg bg-tp-primary px-3 py-1.5 text-xs font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
                        >
                          <Iconify icon="mdi:plus" width={14} />
                          Grant access
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-tp-hairline">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-tp-hairline bg-tp-surface/50">
                              <th className="px-4 py-2.5 text-left text-xs font-semibold text-tp-steel">
                                Name
                              </th>
                              {(['GET', 'CREATE', 'PUT', 'DELETE'] as const).map(perm => (
                                <th
                                  key={perm}
                                  className="px-4 py-2.5 text-center text-xs font-semibold text-tp-steel"
                                >
                                  {PERMISSION_LABELS[perm]}
                                </th>
                              ))}
                              {canManage && <th className="px-4 py-2.5" />}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-tp-hairline">
                            {entityScopedPermissions.map(permission => {
                              const persisted = persistedPermissionsByTarget.get(
                                permissionTarget(permission)
                              );
                              const isPending =
                                !persisted ||
                                !permissionsMatch(persisted.permissions, permission.permissions);

                              return (
                                <tr
                                  key={permission.id}
                                  className={`transition-colors hover:bg-tp-surface/30 ${isPending ? 'bg-tp-primary/5' : ''}`}
                                >
                                  <td className="px-4 py-2.5 font-medium text-tp-ink">
                                    {permission.entityName ?? 'Unknown'}
                                  </td>
                                  {(['GET', 'CREATE', 'PUT', 'DELETE'] as const).map(perm => (
                                    <td key={perm} className="px-4 py-2.5 text-center">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleToggleEntityPermission(perm, permission)
                                        }
                                        disabled={!canManage || isSaving}
                                        className={`inline-flex items-center justify-center rounded-full p-1.5 transition-colors cursor-pointer ${
                                          permission.permissions[perm]
                                            ? PERMISSION_COLORS[perm]
                                            : 'bg-tp-surface text-tp-muted'
                                        } ${isSaving ? 'opacity-50' : 'hover:opacity-80'}`}
                                        title={`${permission.permissions[perm] ? 'Revoke' : 'Grant'} ${PERMISSION_LABELS[perm]}`}
                                      >
                                        <Iconify
                                          icon={
                                            permission.permissions[perm] ? 'mdi:check' : 'mdi:close'
                                          }
                                          width={14}
                                        />
                                      </button>
                                    </td>
                                  ))}
                                  {canManage && (
                                    <td className="px-4 py-2.5 text-center">
                                      <button
                                        type="button"
                                        onClick={() => handleRemovePermission(permission)}
                                        disabled={isSaving}
                                        className="cursor-pointer text-tp-muted transition-colors hover:text-red-500"
                                        title="Remove permission"
                                      >
                                        <Iconify icon="mdi:trash-can-outline" width={15} />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddModal(true);
                            setAddSearch('');
                            setAddPermissions({
                              GET: true,
                              PUT: false,
                              DELETE: false,
                              CREATE: false,
                            });
                          }}
                          className="mt-3 flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong px-3 py-1.5 text-xs font-medium text-tp-slate transition-colors hover:bg-tp-surface"
                        >
                          <Iconify icon="mdi:plus" width={14} />
                          Add {entityTab}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add permission modal ── */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-tp-ink/30 p-4 backdrop-blur-sm"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-[90dvw] max-w-150 rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-xl text-tp-ink">
                Grant {entityTab === 'pricing' ? 'pricing' : 'collection'} access
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="cursor-pointer text-tp-steel transition-colors hover:text-tp-ink"
              >
                <Iconify icon="mdi:close" width={20} />
              </button>
            </div>

            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-tp-steel">
              Search
            </label>
            <input
              type="text"
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
              placeholder={`Search ${entityTab}s...`}
              autoFocus
              className="mb-4 h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none"
            />

            <div className="max-h-48 divide-y divide-tp-hairline overflow-y-auto rounded-lg border border-tp-hairline">
              {availableEntities.length === 0 && (
                <div className="py-6 text-center text-xs text-tp-steel">
                  No {entityTab}s available.
                </div>
              )}
              {availableEntities.map(entity => {
                return (
                  <button
                    key={entity.slug}
                    type="button"
                    onClick={() => handleAddPermission(entity.slug)}
                    disabled={isSaving}
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-tp-surface/60 disabled:opacity-50"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tp-cream text-tp-primary">
                      {entityTab === 'pricing' ? (
                        <FaFileInvoiceDollar size={16} />
                      ) : (
                        <Iconify icon="mdi:folder-outline" width={16} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-tp-ink">{entity.label}</p>
                      <p className="truncate text-[11px] text-tp-steel">{entity.sub}</p>
                    </div>
                    <Iconify icon="mdi:plus" width={16} className="shrink-0 text-tp-muted" />
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-tp-steel">
                Permissions to grant
              </label>
              <div className="flex gap-2">
                {(['GET', 'CREATE', 'PUT', 'DELETE'] as const).map(perm => (
                  <button
                    key={perm}
                    type="button"
                    onClick={() => setAddPermissions(prev => ({ ...prev, [perm]: !prev[perm] }))}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      addPermissions[perm]
                        ? PERMISSION_COLORS[perm]
                        : 'border-tp-hairline-strong bg-tp-surface text-tp-slate hover:bg-tp-canvas'
                    }`}
                  >
                    {PERMISSION_LABELS[perm]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong px-4 py-2 text-sm font-medium text-tp-slate transition-colors hover:bg-tp-surface"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
