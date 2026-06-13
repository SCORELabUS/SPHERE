import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiCheck, FiLoader } from 'react-icons/fi';
import { useUserSettingsApi, type UserSettings } from '../api/userSettingsApi';
import AvatarEditor from './AvatarEditor';

interface Props {
  settings: UserSettings;
  onUpdate: (partial: Partial<UserSettings>) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function PublicProfileSection({ settings, onUpdate, onDirtyChange }: Props) {
  const api = useUserSettingsApi();

  const s = settings.settings;

  const [displayName, setDisplayName] = useState(s?.profile?.displayName || '');
  const [bio, setBio] = useState(s?.profile?.bio || '');
  const [city, setCity] = useState(s?.profile?.city || '');
  const [country, setCountry] = useState(s?.profile?.country || '');
  const [dateOfBirth, setDateOfBirth] = useState(s?.profile?.dateOfBirth || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const hasChanges =
    displayName !== (s?.profile?.displayName || '') ||
    bio !== (s?.profile?.bio || '') ||
    city !== (s?.profile?.city || '') ||
    country !== (s?.profile?.country || '') ||
    dateOfBirth !== (s?.profile?.dateOfBirth || '');

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const result = await api.updateProfile({
        displayName: displayName || undefined,
        bio: bio || undefined,
        city: city || undefined,
        country: country || undefined,
        dateOfBirth: dateOfBirth || undefined,
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
        <h2 className="text-lg font-medium text-tp-ink">Public Profile</h2>
        <p className="mt-0.5 text-sm text-tp-steel">Control how other users see you on the platform</p>
      </div>

      <div className="rounded-lg border border-tp-hairline bg-tp-canvas p-6">
        <AvatarEditor settings={settings} onUpdate={onUpdate} />

        <div className="my-6 border-t border-tp-hairline" />

        {/* Profile form */}
        <div className="space-y-4">
          <Field label="Display Name" value={displayName} onChange={setDisplayName} placeholder="Name others will see" hint="If set, this replaces your real name in rankings" />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-tp-steel">Bio</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell us something about yourself..." rows={3} maxLength={200} className="w-full rounded-md border border-tp-hairline-strong bg-tp-canvas px-3.5 py-2.5 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20" />
            <p className="mt-1 text-right text-xs text-tp-steel">{bio.length}/200</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" value={city} onChange={setCity} placeholder="Madrid" />
            <Field label="Country" value={country} onChange={setCountry} placeholder="Spain" />
          </div>
          <Field label="Date of Birth" value={dateOfBirth} onChange={setDateOfBirth} type="date" />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={handleSaveProfile} disabled={!hasChanges || saving} className="flex cursor-pointer items-center gap-2 rounded-md bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary transition-all disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? <FiLoader className="h-4 w-4 animate-spin" /> : saved ? <FiCheck className="h-4 w-4" /> : null}
            {saved ? 'Saved' : 'Save Changes'}
          </motion.button>
          {hasChanges && !saved && (
            <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-tp-steel">
              You have unsaved changes
            </motion.span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-tp-steel">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-md border border-tp-input-border bg-tp-input-bg px-3.5 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20" />
      {hint && <p className="mt-1 text-xs text-tp-steel">{hint}</p>}
    </div>
  );
}
