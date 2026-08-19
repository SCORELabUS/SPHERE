import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import Iconify from '../../../../core/components/iconify';
import UserAvatar from '../../../../core/components/user-avatar';
import { transitionDefault } from '../../../../core/utils/motion-variants';
import customAlert from '../../../../core/utils/custom-alert';
import customConfirm from '../../../../core/utils/custom-confirm';
import { OrgMemberWithUser, OrgRole, useOrganizationsApi } from '../../../api/organizationsApi';
import { ROLE_LABELS, ROLE_COLORS } from '../constants';

interface Props {
  orgId: string;
  members: OrgMemberWithUser[];
  canManage: boolean;
  currentUserId: string | undefined;
  managerRole: OrgRole | null;
  onRefresh: () => Promise<void>;
  onAddMember: () => void;
  onLeave: () => void;
  isPublicView?: boolean;
}

export default function MembersTab({
  orgId,
  members,
  canManage,
  currentUserId,
  managerRole,
  onRefresh,
  onAddMember,
  onLeave,
  isPublicView = false,
}: Props) {
  const { updateMemberRole, removeMember } = useOrganizationsApi();
  const [draftRoles, setDraftRoles] = useState<Record<string, OrgRole>>({});
  const [isSavingRoles, setIsSavingRoles] = useState(false);

  useEffect(() => {
    setDraftRoles({});
  }, [orgId]);

  useEffect(() => {
    const currentRoles = new Map(members.map(member => [member.user.id, member.role]));
    setDraftRoles(previous =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([userId, role]) => currentRoles.has(userId) && currentRoles.get(userId) !== role
        )
      )
    );
  }, [members]);

  const pendingRoleChanges = useMemo(
    () =>
      members.flatMap(member => {
        const draftRole = draftRoles[member.user.id];
        return draftRole && draftRole !== member.role ? [{ member, role: draftRole }] : [];
      }),
    [draftRoles, members]
  );

  const handleRemoveMember = (member: OrgMemberWithUser) => {
    customConfirm(`Remove @${member.user.username} from this organization?`, { danger: true })
      .then(() =>
        removeMember(orgId, member.user.id)
          .then(() => {
            if (member.user.id === currentUserId) {
              onLeave();
            } else {
              onRefresh();
            }
          })
          .catch((err: Error) => customAlert(err.message, 'error'))
      )
      .catch(() => {});
  };

  const handleRoleChange = (member: OrgMemberWithUser, newRole: OrgRole) => {
    setDraftRoles(previous => {
      if (newRole === member.role) {
        const remaining = { ...previous };
        delete remaining[member.user.id];
        return remaining;
      }
      return { ...previous, [member.user.id]: newRole };
    });
  };

  const handleSaveRoles = async () => {
    if (pendingRoleChanges.length === 0 || isSavingRoles) return;

    setIsSavingRoles(true);
    const results = await Promise.allSettled(
      pendingRoleChanges.map(({ member, role }) => updateMemberRole(orgId, member.user.id, role))
    );
    const failedChanges = pendingRoleChanges.filter(
      (_, index) => results[index].status === 'rejected'
    );

    await onRefresh();
    setDraftRoles(
      Object.fromEntries(failedChanges.map(({ member, role }) => [member.user.id, role]))
    );
    setIsSavingRoles(false);

    if (failedChanges.length > 0) {
      const firstFailure = results.find(result => result.status === 'rejected');
      const reason =
        firstFailure?.status === 'rejected' && firstFailure.reason instanceof Error
          ? ` ${firstFailure.reason.message}`
          : '';
      customAlert(
        `${pendingRoleChanges.length - failedChanges.length} role change(s) saved; ${failedChanges.length} failed.${reason}`,
        'error'
      );
      return;
    }

    customAlert(
      `${pendingRoleChanges.length} role change${pendingRoleChanges.length === 1 ? '' : 's'} saved successfully.`,
      'success'
    );
  };

  return (
    <motion.div
      key="members"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="rounded-xl border border-tp-hairline bg-tp-canvas">
        <div className="flex flex-col gap-3 border-b border-tp-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-tp-ink">Members</h2>
            <p className="text-xs text-tp-steel">
              {isPublicView
                ? 'People who belong to this organization.'
                : 'Manage who has access to this organization.'}
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onAddMember}
                disabled={isSavingRoles}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-ink transition-colors hover:border-tp-primary hover:text-tp-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Iconify icon="mdi:account-plus-outline" width={16} />
                Add member
              </button>
              <button
                type="button"
                onClick={handleSaveRoles}
                disabled={pendingRoleChanges.length === 0 || isSavingRoles}
                title={
                  pendingRoleChanges.length === 0
                    ? 'Change one or more roles to enable saving'
                    : `Save ${pendingRoleChanges.length} role change${pendingRoleChanges.length === 1 ? '' : 's'}`
                }
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-sm font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Iconify
                  icon={isSavingRoles ? 'mdi:loading' : 'mdi:content-save-outline'}
                  width={16}
                  className={isSavingRoles ? 'animate-spin' : ''}
                />
                {isSavingRoles ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          )}
        </div>

        {canManage && pendingRoleChanges.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-3 border-b border-tp-primary/20 bg-tp-primary/5 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-2 text-sm text-tp-ink">
              <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-tp-primary px-2 text-xs font-semibold text-tp-on-primary">
                {pendingRoleChanges.length}
              </span>
              <span>
                {pendingRoleChanges.length} role change
                {pendingRoleChanges.length === 1 ? '' : 's'} ready to save
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDraftRoles({})}
              disabled={isSavingRoles}
              className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard
            </button>
          </motion.div>
        )}

        <div className="divide-y divide-tp-hairline">
          {members.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-tp-ink">
              <Iconify icon="mdi:account-group-outline" width={32} />
              <p className="text-sm">No members yet.</p>
            </div>
          )}

          {members.map(member => {
            const displayedRole = draftRoles[member.user.id] ?? member.role;
            const hasPendingRole = displayedRole !== member.role;
            const canEditRole =
              member.user.id !== currentUserId &&
              (managerRole === 'OWNER' || member.role !== 'OWNER');

            return (
              <div
                key={member.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-tp-surface/50"
              >
                <UserAvatar
                  username={member.user.username}
                  avatar={member.user.avatar}
                  avatarBgColor={member.user.avatarBgColor}
                  avatarFgColor={member.user.avatarFgColor}
                  size={36}
                />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-tp-ink">@{member.user.username}</p>
                  <p className="text-[11px] text-tp-steel">{member.user.email}</p>
                </div>

                {!isPublicView && canManage && canEditRole && (
                  <select
                    value={displayedRole}
                    onChange={event => handleRoleChange(member, event.target.value as OrgRole)}
                    disabled={isSavingRoles}
                    aria-label={`Role for ${member.user.username}`}
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
                )}
                {!isPublicView && (!canManage || !canEditRole) && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ROLE_COLORS[member.role]}`}
                  >
                    {ROLE_LABELS[member.role]}
                  </span>
                )}
                {!isPublicView && canManage && member.user.id !== currentUserId && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member)}
                    disabled={isSavingRoles}
                    title={
                      member.user.id === currentUserId ? 'Leave organization' : 'Remove member'
                    }
                    className="cursor-pointer text-tp-hairline-strong transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Iconify icon="mdi:account-remove-outline" width={18} />
                  </button>
                )}
                {!isPublicView && member.user.id === currentUserId && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member)}
                    disabled={isSavingRoles}
                    title={
                      member.user.id === currentUserId ? 'Leave organization' : 'Remove member'
                    }
                    className="cursor-pointer text-tp-hairline-strong transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Iconify icon="mdi:logout" width={18} className="text-red-600" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
