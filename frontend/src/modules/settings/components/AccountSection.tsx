import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiCheck, FiLoader } from 'react-icons/fi';
import { useUserSettingsApi, type UserSettings } from '../api/userSettingsApi';

interface Props {
  settings: UserSettings;
  onUpdate: (partial: Partial<UserSettings>) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function AccountSection({ settings, onUpdate, onDirtyChange }: Props) {
  const api = useUserSettingsApi();
  const [email, setEmail] = useState(settings.email);
  const [firstName, setFirstName] = useState(settings.firstName);
  const [lastName, setLastName] = useState(settings.lastName);
  const [phone, setPhone] = useState(settings.settings?.phone || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const hasChanges =
    email !== settings.email ||
    firstName !== settings.firstName ||
    lastName !== settings.lastName ||
    phone !== (settings.settings?.phone || '');

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await api.updateAccount({
        email,
        firstName,
        lastName,
        phone: phone || undefined,
      });
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
        <h2 className="text-lg font-medium text-tp-ink">Account Details</h2>
        <p className="mt-0.5 text-sm text-tp-steel">
          Manage your personal information and contact details
        </p>
      </div>

      <div className="rounded-lg border border-tp-hairline bg-tp-canvas p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First Name" value={firstName} onChange={setFirstName} placeholder="Your first name" />
          <Field label="Last Name" value={lastName} onChange={setLastName} placeholder="Your last name" />
          <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
          <Field label="Phone (optional)" value={phone} onChange={setPhone} placeholder="+34 600 000 000" type="tel" />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex cursor-pointer items-center gap-2 rounded-md bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary transition-all disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <FiLoader className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <FiCheck className="h-4 w-4" />
            ) : null}
            {saved ? 'Saved' : 'Save Changes'}
          </motion.button>
          {hasChanges && !saved && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xs text-tp-steel"
            >
              You have unsaved changes
            </motion.span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-tp-steel">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-md border border-tp-input-border bg-tp-input-bg px-3.5 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20"
      />
    </div>
  );
}
