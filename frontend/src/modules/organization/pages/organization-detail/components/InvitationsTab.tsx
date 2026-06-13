import { useState } from 'react';
import { motion } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import { transitionDefault } from '../../../../core/utils/motion-variants';
import customAlert from '../../../../core/utils/custom-alert';
import customConfirm from '../../../../core/utils/custom-confirm';
import { OrganizationInvitation, useOrganizationsApi } from '../../../api/organizationsApi';

interface Props {
  orgId: string;
  invitations: OrganizationInvitation[];
  canManage: boolean;
  onRefresh: () => void;
  onOpenInvite: () => void;
}

export default function InvitationsTab({ orgId, invitations, canManage, onRefresh, onOpenInvite }: Props) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const { revokeInvitation } = useOrganizationsApi();

  const handleCopy = (code: string) => {
    const joinUrl = `${window.location.origin}/orgs/join/${code}`;
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  return (
    <motion.div
      key="invitations"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="rounded-xl border border-tp-hairline bg-tp-canvas">
        <div className="flex flex-col gap-3 border-b border-tp-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-tp-ink">Invitations</h2>
            <p className="text-xs text-tp-steel">Manage invitation links for this organization.</p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={onOpenInvite}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-sm font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
            >
              <Iconify icon="mdi:link-plus" width={16} />
              Generate invite
            </button>
          )}
        </div>

        <div className="divide-y divide-tp-hairline">
          {invitations.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-tp-ink">
              <Iconify icon="mdi:link-variant-off" width={32} />
              <p className="text-sm">No invitations yet.</p>
            </div>
          )}

          {invitations.map((inv) => {
            const isActive = !inv.expiresAt || new Date(inv.expiresAt) > new Date();
            return (
              <div
                key={inv.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-tp-surface/50"
              >
                <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-tp-slate">
                  {inv.code}
                </code>
                <span className="whitespace-nowrap text-[11px] text-tp-ink">
                  {inv.useCount} use{inv.useCount !== 1 ? 's' : ''}
                  {inv.maxUses ? ` / ${inv.maxUses}` : ''}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                  {isActive ? 'Active' : 'Expired'}
                </span>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopy(inv.code)}
                      title="Copy invite link"
                      className="cursor-pointer text-tp-hairline-strong transition-colors hover:text-tp-primary"
                    >
                      <Iconify icon={copiedCode === inv.code ? 'mdi:check' : 'mdi:content-copy'} width={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        customConfirm('Revoke this invitation?', { danger: true })
                          .then(() => revokeInvitation(orgId, inv.id).then(() => onRefresh()).catch((err: Error) => customAlert(err.message, 'error')))
                          .catch(() => {});
                      }}
                      className="cursor-pointer text-tp-hairline-strong transition-colors hover:text-red-500"
                    >
                      <Iconify icon="mdi:trash-can-outline" width={16} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
