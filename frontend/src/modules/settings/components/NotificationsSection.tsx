import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { FiCheck, FiLoader, FiMail, FiInbox } from 'react-icons/fi';
import { useUserSettingsApi, type UserSettings } from '../api/userSettingsApi';

interface Props {
  settings: UserSettings;
  onUpdate: (partial: Partial<UserSettings>) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const NOTIFICATION_KINDS = [
  { key: 'OrganizationInvitation', label: 'Organization Invitations', description: 'When someone invites you to an organization' },
  { key: 'System', label: 'System Notices', description: 'Important platform updates and maintenance notices' },
  { key: 'CollectionShared', label: 'Collection Shared', description: 'When someone shares a pricing collection with you' },
  { key: 'PricingUpdated', label: 'Pricing Updated', description: 'When a pricing you follow is updated' },
] as const;

const CHANNELS = [
  { key: 'email' as const, label: 'Email', icon: FiMail, description: 'Receive via email' },
  { key: 'inbox' as const, label: 'In-App', icon: FiInbox, description: 'Notification panel' },
];

const DEFAULT_PREFS: Record<string, { email: boolean; inbox: boolean }> = {};
NOTIFICATION_KINDS.forEach((kind) => {
  DEFAULT_PREFS[kind.key] = { email: true, inbox: true };
});

export default function NotificationsSection({ settings, onUpdate, onDirtyChange }: Props) {
  const api = useUserSettingsApi();
  const [prefs, setPrefs] = useState<Record<string, { email: boolean; inbox: boolean }>>(
    settings.settings?.notificationPrefs || DEFAULT_PREFS
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const defaultPrefs = useMemo(() => settings.settings?.notificationPrefs || DEFAULT_PREFS, [settings.settings?.notificationPrefs]);

  const hasChanges = JSON.stringify(prefs) !== JSON.stringify(defaultPrefs);

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  const toggleChannel = (kind: string, channel: 'email' | 'inbox') => {
    setPrefs((prev) => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        [channel]: !prev[kind]?.[channel],
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await api.updateNotificationPrefs(prefs);
      onUpdate(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-tp-ink">Notifications</h2>
        <p className="mt-0.5 text-sm text-tp-steel">
          Configure which notifications you receive and how
        </p>
      </div>

      <div className="rounded-[12px] border border-tp-hairline bg-tp-canvas">
        {/* Header */}
        <div className="grid grid-cols-[1fr_repeat(2,80px)] items-center gap-2 border-b border-tp-hairline px-6 py-3">
          <span className="text-xs font-medium text-tp-steel">Notification Type</span>
          {CHANNELS.map((ch) => (
            <div key={ch.key} className="flex flex-col items-center gap-0.5">
              <ch.icon className="h-4 w-4 text-tp-steel" />
              <span className="text-[10px] font-medium text-tp-steel">{ch.label}</span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {NOTIFICATION_KINDS.map((kind, i) => (
          <div
            key={kind.key}
            className={`grid grid-cols-[1fr_repeat(2,80px)] items-center gap-2 px-6 py-4 transition-colors hover:bg-tp-surface ${
              i < NOTIFICATION_KINDS.length - 1 ? 'border-b border-tp-hairline' : ''
            }`}
          >
            <div>
              <p className="text-sm font-medium text-tp-ink">{kind.label}</p>
              <p className="text-xs text-tp-steel">{kind.description}</p>
            </div>
            {CHANNELS.map((ch) => {
              const isOn = prefs[kind.key]?.[ch.key] ?? false;
              return (
                <div key={ch.key} className="flex justify-center">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    type="button"
                    onClick={() => toggleChannel(kind.key, ch.key)}
                    className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-200 ${
                      isOn ? 'bg-tp-primary' : 'bg-tp-hairline-strong'
                    }`}
                  >
                    <motion.div
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm"
                      animate={{ left: isOn ? 22 : 2 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </motion.button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary transition-all disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <FiLoader className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <FiCheck className="h-4 w-4" />
          ) : null}
          {saved ? 'Saved' : 'Save Preferences'}
        </motion.button>
        {saved && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xs text-tp-primary"
          >
            Preferences updated
          </motion.span>
        )}
      </div>
    </div>
  );
}
