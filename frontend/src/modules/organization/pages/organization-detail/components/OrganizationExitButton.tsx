import { useState } from 'react';
import Iconify from '../../../../core/components/iconify';
import customAlert from '../../../../core/utils/custom-alert';
import customConfirm from '../../../../core/utils/custom-confirm';
import { OrgMemberWithUser, useOrganizationsApi } from '../../../api/organizationsApi';

interface Props {
  orgId: string;
  isPersonal: boolean;
  members: OrgMemberWithUser[];
  currentUserId?: string;
  onExited: () => void | Promise<void>;
  compact?: boolean;
  disabled?: boolean;
}

export default function OrganizationExitButton({
  orgId,
  isPersonal,
  members,
  currentUserId,
  onExited,
  compact = false,
  disabled = false,
}: Props) {
  const { deleteOrganization, removeMember } = useOrganizationsApi();
  const [isBusy, setIsBusy] = useState(false);
  const canDelete =
    members.length === 1 && members[0].user.id === currentUserId && members[0].role === 'OWNER';
  const label = canDelete ? 'Delete organization' : 'Leave organization';

  if (isPersonal || !currentUserId) return null;

  const handleClick = async () => {
    if (isBusy || disabled) return;
    setIsBusy(true);
    try {
      await customConfirm(
        canDelete
          ? 'Delete this organization? Deleting an organization will delete all resources associated with it, including all sub-organizations and their resources. This action cannot be undone.'
          : 'Are you sure you want to leave this organization? You will lose access to all its resources.',
        { danger: true, confirmLabel: canDelete ? 'Delete organization' : 'Leave' }
      );
    } catch {
      setIsBusy(false);
      return;
    }

    try {
      if (canDelete) await deleteOrganization(orgId);
      else await removeMember(orgId, currentUserId);
      await onExited();
    } catch (err) {
      customAlert((err as Error).message, 'error');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isBusy}
      title={label}
      aria-label={label}
      className={
        compact
          ? 'cursor-pointer text-red-600 transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400'
          : 'flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-900/40'
      }
    >
      <Iconify
        icon={canDelete ? 'mdi:trash-can-outline' : 'mdi:logout'}
        width={compact ? 18 : 15}
      />
      {!compact && (canDelete ? 'Delete organization' : 'Leave')}
    </button>
  );
}
