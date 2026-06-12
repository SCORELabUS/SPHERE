import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import { staggerContainer, fadeInUp } from '../../../../core/utils/motion-variants';
import customAlert from '../../../../core/utils/custom-alert';
import customConfirm from '../../../../core/utils/custom-confirm';
import { OrganizationInvitation, useOrganizationsApi } from '../../../api/organizationsApi';
import UserSearchInput, { UserSearchResult } from '../../../components/user-search-input';

const SPRING_MODAL = { type: 'spring' as const, stiffness: 400, damping: 30 };
const SPRING_SOFT = { type: 'spring' as const, stiffness: 300, damping: 24 };
const TAB_CONTENT_VARIANTS = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

interface Props {
  orgId: string;
  invitations: OrganizationInvitation[];
  onClose: () => void;
  onRefresh: () => void;
}

export default function InviteModal({ orgId, invitations, onClose, onRefresh }: Props) {
  const [activeTab, setActiveTab] = useState<'link' | 'users'>('link');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<UserSearchResult[]>([]);
  const [isInviting, setIsInviting] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [maxUses, setMaxUses] = useState<string>('');
  const { createInvitation, revokeInvitation, inviteUsers } = useOrganizationsApi();

  const handleGenerate = () => {
    setIsGenerating(true);
    const maxUsesNum = maxUses ? parseInt(maxUses, 10) : undefined;
    createInvitation(orgId, {
      expiresInDays,
      ...(maxUsesNum && maxUsesNum > 0 ? { maxUses: maxUsesNum } : {}),
    })
      .then(() => onRefresh())
      .catch((err: Error) => customAlert(err.message, 'error'))
      .finally(() => setIsGenerating(false));
  };

  const handleRevoke = (inv: OrganizationInvitation) => {
    customConfirm('Revoke this invitation? Members with this code will no longer be able to join.', { danger: true })
      .then(() => revokeInvitation(orgId, inv.id).then(() => onRefresh()).catch((err: Error) => customAlert(err.message, 'error')))
      .catch(() => {});
  };

  const handleCopy = (code: string) => {
    const joinUrl = `${window.location.origin}/orgs/join/${code}`;
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  const handleInviteUsers = async () => {
    if (selectedUsers.length === 0) return;
    setIsInviting(true);
    try {
      await inviteUsers(orgId, selectedUsers.map((u) => u.id));
      customAlert(`${selectedUsers.length} invitation(s) sent successfully!`, 'success');
      setSelectedUsers([]);
      onRefresh();
      onClose();
    } catch (err: any) {
      customAlert(err.message || 'Failed to send invitations', 'error');
    } finally {
      setIsInviting(false);
    }
  };

  const activeInvitations = invitations.filter((inv) => !inv.expiresAt || new Date(inv.expiresAt) > new Date());

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-tp-ink/30 p-4 backdrop-blur-sm sm:p-0"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={SPRING_MODAL}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[36rem] overflow-hidden rounded-xl border border-tp-hairline-soft bg-tp-canvas shadow-elevation-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          <h2 className="font-display text-xl text-tp-ink">Invite Members</h2>
          <motion.button
            onClick={onClose}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            transition={SPRING_SOFT}
            className="cursor-pointer rounded-lg p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
          >
            <Iconify icon="mdi:close" width={18} />
          </motion.button>
        </div>

        {/* Tabs */}
        <div className="relative mx-6 mt-4 mb-0 flex gap-1 rounded-lg border border-tp-hairline-soft bg-tp-surface p-1">
          {(['link', 'users'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative z-10 flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                activeTab === tab ? 'text-tp-ink' : 'text-tp-steel hover:text-tp-ink'
              }`}
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="invite-tab-bg"
                  className="absolute inset-0 rounded-md bg-tp-canvas shadow-sm"
                  transition={SPRING_MODAL}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Iconify icon={tab === 'link' ? 'mdi:link' : 'mdi:account-search'} width={16} />
                {tab === 'link' ? 'Invite Link' : 'Invite Users'}
              </span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="px-6 pt-5 pb-6">
          <AnimatePresence mode="wait">
            {activeTab === 'link' ? (
              <motion.div key="link" variants={TAB_CONTENT_VARIANTS} initial="initial" animate="animate" exit="exit">
                <p className="mb-5 text-sm leading-relaxed text-tp-steel">
                  Share an invite link. Anyone with the link can join this organization as a member.
                </p>

                {/* Configuration */}
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                  className="mb-5 grid grid-cols-2 gap-3"
                >
                  <motion.div variants={fadeInUp} className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-tp-steel">Expires in</label>
                    <div className="relative">
                      <select
                        value={expiresInDays}
                        onChange={(e) => setExpiresInDays(Number(e.target.value))}
                        className="cursor-pointer w-full appearance-none rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 pr-8 text-sm text-tp-ink outline-none transition-all duration-200 focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
                      >
                        <option value={1}>1 day</option>
                        <option value={3}>3 days</option>
                        <option value={7}>7 days</option>
                        <option value={14}>14 days</option>
                        <option value={30}>30 days</option>
                        <option value={90}>90 days</option>
                      </select>
                      <Iconify icon="mdi:chevron-down" width={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-tp-muted" />
                    </div>
                  </motion.div>

                  <motion.div variants={fadeInUp} className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-tp-steel">Max uses</label>
                    <input
                      type="number"
                      min={1}
                      value={maxUses}
                      onChange={(e) => setMaxUses(e.target.value)}
                      placeholder="Unlimited"
                      className="rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 text-sm text-tp-ink outline-none transition-all duration-200 placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
                    />
                  </motion.div>
                </motion.div>

                {/* Generate button */}
                <motion.button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={SPRING_SOFT}
                  className="mb-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary shadow-sm transition-colors duration-200 hover:bg-tp-primary-deep disabled:opacity-50"
                >
                  <Iconify icon={isGenerating ? 'mdi:loading' : 'mdi:link-plus'} width={18} className={isGenerating ? 'animate-spin' : ''} />
                  {isGenerating ? 'Generating...' : 'Generate new invite link'}
                </motion.button>

                {/* Active invitations */}
                <AnimatePresence>
                  {activeInvitations.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-tp-ink">Active invitations</p>
                      <div className="flex flex-col gap-1.5">
                        <AnimatePresence>
                          {activeInvitations.map((inv, i) => (
                            <motion.div
                              key={inv.id}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04, ...SPRING_SOFT } }}
                              exit={{ opacity: 0, x: -12, transition: { duration: 0.15 } }}
                              layout
                              className="group flex items-center gap-2 rounded-lg border border-tp-hairline-soft bg-tp-surface px-3 py-2.5 transition-all duration-200 hover:border-tp-hairline-strong hover:bg-tp-canvas"
                            >
                              <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-tp-slate">
                                {inv.code}
                              </code>
                              <span className="whitespace-nowrap text-[11px] text-tp-ink">
                                {inv.useCount}{inv.maxUses ? ` / ${inv.maxUses}` : ''} use{inv.useCount !== 1 ? 's' : ''}
                              </span>
                              {inv.expiresAt && (
                                <span className="whitespace-nowrap text-[11px] text-tp-steel">
                                  · exp {new Date(inv.expiresAt).toLocaleDateString()}
                                </span>
                              )}
                              <div className="flex items-center gap-0.5 opacity-60 transition-opacity duration-150 group-hover:opacity-100">
                                <motion.button
                                  onClick={() => handleCopy(inv.code)}
                                  whileHover={{ scale: 1.15 }}
                                  whileTap={{ scale: 0.9 }}
                                  transition={SPRING_SOFT}
                                  title="Copy invite link"
                                  className="cursor-pointer rounded p-1 text-tp-ink transition-colors hover:bg-tp-surface hover:text-tp-primary"
                                >
                                  <Iconify icon={copiedCode === inv.code ? 'mdi:check' : 'mdi:content-copy'} width={14} />
                                </motion.button>
                                <motion.button
                                  onClick={() => handleRevoke(inv)}
                                  whileHover={{ scale: 1.15 }}
                                  whileTap={{ scale: 0.9 }}
                                  transition={SPRING_SOFT}
                                  title="Revoke invitation"
                                  className="cursor-pointer rounded p-1 text-tp-ink transition-colors hover:bg-red-50 hover:text-red-500"
                                >
                                  <Iconify icon="mdi:trash-can-outline" width={14} />
                                </motion.button>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {activeInvitations.length === 0 && (
                  <p className="text-center text-sm text-tp-ink">No active invitations.</p>
                )}
              </motion.div>
            ) : (
              <motion.div key="users" variants={TAB_CONTENT_VARIANTS} initial="initial" animate="animate" exit="exit">
                <p className="mb-4 text-sm leading-relaxed text-tp-steel">
                  Search for users by username to send them an invitation notification. They can accept directly from their inbox.
                </p>

                <div className="mb-4">
                  <UserSearchInput
                    selectedUsers={selectedUsers}
                    onUsersChange={setSelectedUsers}
                    placeholder="Type at least 4 characters to search..."
                    maxUsers={20}
                  />
                </div>

                <AnimatePresence>
                  {selectedUsers.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="mb-4 overflow-hidden"
                    >
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-tp-ink">
                        {selectedUsers.length} user{selectedUsers.length !== 1 ? 's' : ''} selected
                      </p>
                      <p className="mb-3 text-xs text-tp-steel">
                        An invitation link will be generated with {selectedUsers.length} use{selectedUsers.length !== 1 ? 's' : ''} and each user will receive a notification.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  onClick={handleInviteUsers}
                  disabled={selectedUsers.length === 0 || isInviting}
                  whileHover={{ scale: selectedUsers.length > 0 ? 1.01 : 1 }}
                  whileTap={{ scale: selectedUsers.length > 0 ? 0.98 : 1 }}
                  transition={SPRING_SOFT}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary shadow-sm transition-colors duration-200 hover:bg-tp-primary-deep disabled:opacity-50"
                >
                  <Iconify icon={isInviting ? 'mdi:loading' : 'mdi:send'} width={18} className={isInviting ? 'animate-spin' : ''} />
                  {isInviting ? 'Sending...' : `Send Invitation${selectedUsers.length > 1 ? 's' : ''}`}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
