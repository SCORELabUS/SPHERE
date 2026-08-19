import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Iconify from '../../../../core/components/iconify';
import OrgAvatar from '../../../../core/components/org-avatar';
import UserAvatar from '../../../../core/components/user-avatar';
import customAlert from '../../../../core/utils/custom-alert';
import {
  Organization,
  OrgMemberWithUser,
  OrgRole,
  useOrganizationsApi,
} from '../../../api/organizationsApi';
import { ROLE_COLORS, ROLE_LABELS } from '../constants';

interface Props {
  parentOrgId: string;
  organizations: Organization[];
  currentUserId: string | undefined;
  parentManagerRole: OrgRole;
  onNavigate: (id: string) => void;
}

const roleKey = (organizationId: string, userId: string) => `${organizationId}:${userId}`;

export default function ChildRolesManager({
  parentOrgId,
  organizations,
  currentUserId,
  parentManagerRole,
  onNavigate,
}: Props) {
  const { getOrgMembers, updateMemberRole } = useOrganizationsApi();
  const [membersByOrganization, setMembersByOrganization] = useState<
    Record<string, OrgMemberWithUser[]>
  >({});
  const [draftRoles, setDraftRoles] = useState<Record<string, OrgRole>>({});
  const [failedOrganizationIds, setFailedOrganizationIds] = useState<Set<string>>(new Set());
  const [expandedOrganizationIds, setExpandedOrganizationIds] = useState<Set<string>>(
    () => new Set(organizations.map(organization => organization.id))
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const organizationIds = useMemo(
    () => organizations.map(organization => organization.id),
    [organizations]
  );
  const organizationIdsKey = organizationIds.join(',');

  const loadMembers = useCallback(async () => {
    if (organizationIds.length === 0) {
      setMembersByOrganization({});
      setFailedOrganizationIds(new Set());
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const results = await Promise.allSettled(
      organizationIds.map(organizationId => getOrgMembers(organizationId))
    );

    setMembersByOrganization(previous => {
      const next = { ...previous };
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next[organizationIds[index]] = result.value;
      });
      return next;
    });
    setFailedOrganizationIds(
      new Set(organizationIds.filter((_, index) => results[index].status === 'rejected'))
    );
    setIsLoading(false);
  }, [getOrgMembers, organizationIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraftRoles({});
    setExpandedOrganizationIds(new Set(organizationIds));
    void loadMembers();
  }, [parentOrgId, organizationIdsKey, loadMembers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraftRoles(previous => {
      const next: Record<string, OrgRole> = {};
      Object.entries(previous).forEach(([key, role]) => {
        const separatorIndex = key.indexOf(':');
        const organizationId = key.slice(0, separatorIndex);
        const userId = key.slice(separatorIndex + 1);
        const member = membersByOrganization[organizationId]?.find(item => item.user.id === userId);
        if (member && member.role !== role) next[key] = role;
      });
      return next;
    });
  }, [membersByOrganization]);

  const pendingRoleChanges = useMemo(
    () =>
      organizations.flatMap(organization =>
        (membersByOrganization[organization.id] ?? []).flatMap(member => {
          const role = draftRoles[roleKey(organization.id, member.user.id)];
          return role && role !== member.role ? [{ organization, member, role }] : [];
        })
      ),
    [draftRoles, membersByOrganization, organizations]
  );

  const pendingCountByOrganization = useMemo(() => {
    const counts: Record<string, number> = {};
    pendingRoleChanges.forEach(({ organization }) => {
      counts[organization.id] = (counts[organization.id] ?? 0) + 1;
    });
    return counts;
  }, [pendingRoleChanges]);

  const totalMembers = useMemo(
    () =>
      Object.values(membersByOrganization).reduce((total, members) => total + members.length, 0),
    [membersByOrganization]
  );

  const handleRoleChange = (organizationId: string, member: OrgMemberWithUser, role: OrgRole) => {
    const key = roleKey(organizationId, member.user.id);
    setDraftRoles(previous => {
      if (role === member.role) {
        const next = { ...previous };
        delete next[key];
        return next;
      }
      return { ...previous, [key]: role };
    });
  };

  const handleSave = async () => {
    if (pendingRoleChanges.length === 0 || isSaving) return;

    setIsSaving(true);
    try {
      const changesToSave = [...pendingRoleChanges];
      const results = await Promise.allSettled(
        changesToSave.map(({ organization, member, role }) =>
          updateMemberRole(organization.id, member.user.id, role)
        )
      );
      const failedChanges = changesToSave.filter(
        (_, index) => results[index].status === 'rejected'
      );

      await loadMembers();
      setDraftRoles(
        Object.fromEntries(
          failedChanges.map(({ organization, member, role }) => [
            roleKey(organization.id, member.user.id),
            role,
          ])
        )
      );

      if (failedChanges.length > 0) {
        customAlert(
          `${changesToSave.length - failedChanges.length} role change(s) saved; ${failedChanges.length} failed and remain pending.`,
          'error'
        );
      } else {
        customAlert(
          `${changesToSave.length} role change${changesToSave.length === 1 ? '' : 's'} saved across child organizations.`,
          'success'
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const toggleOrganization = (organizationId: string) => {
    setExpandedOrganizationIds(previous => {
      const next = new Set(previous);
      if (next.has(organizationId)) next.delete(organizationId);
      else next.add(organizationId);
      return next;
    });
  };

  const allExpanded = organizations.every(organization =>
    expandedOrganizationIds.has(organization.id)
  );

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas">
      <div className="border-b border-tp-hairline bg-linear-to-r from-tp-primary/8 via-tp-canvas to-tp-canvas px-5 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tp-primary text-tp-on-primary">
                <Iconify icon="mdi:account-cog-outline" width={18} />
              </span>
              <h2 className="font-display text-lg text-tp-ink">Child organization roles</h2>
            </div>
            <p className="text-xs text-tp-steel">
              Edit members across {organizations.length} direct child organization
              {organizations.length === 1 ? '' : 's'} and save everything at once.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setExpandedOrganizationIds(
                  allExpanded
                    ? new Set()
                    : new Set(organizations.map(organization => organization.id))
                )
              }
              className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-xs font-medium text-tp-steel transition-colors hover:border-tp-primary hover:text-tp-primary"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={pendingRoleChanges.length === 0 || isSaving}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-sm font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Iconify
                icon={isSaving ? 'mdi:loading' : 'mdi:content-save-outline'}
                width={16}
                className={isSaving ? 'animate-spin' : ''}
              />
              {isSaving
                ? 'Saving...'
                : `Save changes${pendingRoleChanges.length > 0 ? ` (${pendingRoleChanges.length})` : ''}`}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-tp-steel">
          <span className="rounded-full border border-tp-hairline bg-tp-canvas px-2.5 py-1">
            {organizations.length} organizations
          </span>
          <span className="rounded-full border border-tp-hairline bg-tp-canvas px-2.5 py-1">
            {isLoading ? 'Loading members…' : `${totalMembers} memberships`}
          </span>
          {pendingRoleChanges.length > 0 && (
            <span className="rounded-full bg-tp-primary px-2.5 py-1 font-semibold text-tp-on-primary">
              {pendingRoleChanges.length} pending
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-tp-hairline">
        {organizations.map((organization, organizationIndex) => {
          const members = membersByOrganization[organization.id] ?? [];
          const isExpanded = expandedOrganizationIds.has(organization.id);
          const managerRole =
            members.find(member => member.user.id === currentUserId)?.role ?? parentManagerRole;
          const pendingCount = pendingCountByOrganization[organization.id] ?? 0;
          const failed = failedOrganizationIds.has(organization.id);

          return (
            <motion.section
              key={organization.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: organizationIndex * 0.035 }}
            >
              <div className="flex items-center gap-3 px-5 py-3">
                <button
                  type="button"
                  onClick={() => toggleOrganization(organization.id)}
                  aria-expanded={isExpanded}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tp-steel transition-colors hover:bg-tp-surface">
                    <Iconify
                      icon={isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                      width={17}
                    />
                  </span>
                  <OrgAvatar
                    name={organization.displayName}
                    avatar={organization.avatar}
                    avatarBgColor={organization.avatarBgColor}
                    avatarFgColor={organization.avatarFgColor}
                    size={34}
                    square
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-tp-ink">
                      {organization.displayName}
                    </span>
                    <span className="block text-[11px] text-tp-steel">
                      {failed ? 'Members could not be loaded' : `${members.length} members`}
                    </span>
                  </span>
                  {pendingCount > 0 && (
                    <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[11px] font-semibold text-tp-primary">
                      {pendingCount} pending
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate(organization.id)}
                  title={`Open ${organization.displayName}`}
                  className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-primary"
                >
                  <Iconify icon="mdi:open-in-new" width={16} />
                </button>
              </div>

              {isExpanded && (
                <div className="border-t border-tp-hairline bg-tp-surface/25">
                  {failed ? (
                    <div className="flex items-center justify-between gap-3 px-16 py-4 text-xs text-red-600">
                      <span>Could not load this organization’s members.</span>
                      <button
                        type="button"
                        onClick={() => void loadMembers()}
                        className="cursor-pointer font-semibold hover:underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : isLoading && members.length === 0 ? (
                    <div className="flex items-center gap-2 px-16 py-4 text-xs text-tp-steel">
                      <Iconify icon="mdi:loading" width={15} className="animate-spin" />
                      Loading members…
                    </div>
                  ) : members.length === 0 ? (
                    <p className="px-16 py-4 text-xs text-tp-steel">
                      No members in this organization.
                    </p>
                  ) : (
                    <div className="divide-y divide-tp-hairline">
                      {members.map(member => {
                        const key = roleKey(organization.id, member.user.id);
                        const displayedRole = draftRoles[key] ?? member.role;
                        const hasPendingRole = displayedRole !== member.role;
                        const canEditRole =
                          member.user.id !== currentUserId &&
                          (managerRole === 'OWNER' || member.role !== 'OWNER');

                        return (
                          <div
                            key={member.id}
                            className="flex flex-wrap items-center gap-3 px-5 py-3 pl-16"
                          >
                            <UserAvatar
                              username={member.user.username}
                              avatar={member.user.avatar}
                              avatarBgColor={member.user.avatarBgColor}
                              avatarFgColor={member.user.avatarFgColor}
                              size={30}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-tp-ink">
                                @{member.user.username}
                                {member.user.id === currentUserId && (
                                  <span className="ml-1.5 text-[10px] font-normal text-tp-steel">
                                    you
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-[10px] text-tp-steel">
                                {member.user.email}
                              </p>
                            </div>

                            {canEditRole ? (
                              <select
                                value={displayedRole}
                                onChange={event =>
                                  handleRoleChange(
                                    organization.id,
                                    member,
                                    event.target.value as OrgRole
                                  )
                                }
                                disabled={isSaving}
                                aria-label={`Role for ${member.user.username} in ${organization.displayName}`}
                                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition-all focus:border-tp-primary disabled:cursor-wait disabled:opacity-60 ${
                                  hasPendingRole
                                    ? 'border-tp-primary bg-tp-primary/5 text-tp-primary ring-2 ring-tp-primary/10'
                                    : 'border-tp-input-border bg-tp-input-bg text-tp-slate'
                                }`}
                              >
                                <option value="MEMBER">Member</option>
                                <option value="ADMIN">Admin</option>
                                {managerRole === 'OWNER' && <option value="OWNER">Owner</option>}
                              </select>
                            ) : (
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ROLE_COLORS[member.role]}`}
                              >
                                {ROLE_LABELS[member.role]}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}
