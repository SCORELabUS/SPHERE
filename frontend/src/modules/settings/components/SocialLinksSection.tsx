import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiCheck, FiLoader, FiExternalLink } from 'react-icons/fi';
import { useUserSettingsApi, type UserSettings } from '../api/userSettingsApi';

interface Props {
  settings: UserSettings;
  onUpdate: (partial: Partial<UserSettings>) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const SOCIAL_PLATFORMS = [
  {
    key: 'linkedin' as const,
    label: 'LinkedIn',
    placeholder: 'https://linkedin.com/in/your-profile',
    color: '#0A66C2',
    patterns: [
      /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w\-%.]+\/?$/,
      /^https?:\/\/(www\.)?linkedin\.com\/company\/[\w\-%.]+\/?$/,
    ],
  },
  {
    key: 'instagram' as const,
    label: 'Instagram',
    placeholder: 'https://instagram.com/your-profile',
    color: '#E4405F',
    patterns: [/^https?:\/\/(www\.)?instagram\.com\/[\w%.]+\/?$/],
  },
  {
    key: 'facebook' as const,
    label: 'Facebook',
    placeholder: 'https://facebook.com/your-profile',
    color: '#1877F2',
    patterns: [
      /^https?:\/\/(www\.)?facebook\.com\/[\w%.]+\/?$/,
      /^https?:\/\/(www\.)?facebook\.com\/pages\/[\w\-%.]+\/\d+\/?$/,
    ],
  },
  {
    key: 'x' as const,
    label: 'X (Twitter)',
    placeholder: 'https://x.com/your-handle',
    color: '#000000',
    patterns: [
      /^https?:\/\/(www\.)?x\.com\/[\w]+\/?$/,
      /^https?:\/\/(www\.)?twitter\.com\/[\w]+\/?$/,
    ],
  },
];

function validateUrl(url: string, patterns: RegExp[]): string | null {
  if (!url) return null;
  const isValid = patterns.some((p) => p.test(url));
  return isValid ? null : 'Invalid URL for this platform';
}

export default function SocialLinksSection({ settings, onUpdate, onDirtyChange }: Props) {
  const api = useUserSettingsApi();
  const [links, setLinks] = useState({
    linkedin: settings.settings?.socialLinks?.linkedin || '',
    instagram: settings.settings?.socialLinks?.instagram || '',
    facebook: settings.settings?.socialLinks?.facebook || '',
    x: settings.settings?.socialLinks?.x || '',
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const hasChanges = Object.keys(links).some(
    (key) => links[key as keyof typeof links] !== ((settings.settings?.socialLinks as any)?.[key] || '')
  );

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  const handleChange = (key: string, value: string) => {
    setLinks((prev) => ({ ...prev, [key]: value }));
    const platform = SOCIAL_PLATFORMS.find((p) => p.key === key);
    if (platform) {
      setErrors((prev) => ({
        ...prev,
        [key]: value ? validateUrl(value, platform.patterns) : null,
      }));
    }
  };

  const handleSave = async () => {
    const newErrors: Record<string, string | null> = {};
    let hasError = false;

    for (const platform of SOCIAL_PLATFORMS) {
      const url = links[platform.key];
      if (url) {
        const error = validateUrl(url, platform.patterns);
        newErrors[platform.key] = error;
        if (error) hasError = true;
      }
    }

    setErrors(newErrors);
    if (hasError) return;

    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const key of Object.keys(links)) {
        if (links[key as keyof typeof links]) {
          payload[key] = links[key as keyof typeof links];
        }
      }
      const result = await api.updateSocialLinks(payload as any);
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
        <h2 className="text-lg font-medium text-tp-ink">Social Links</h2>
        <p className="mt-0.5 text-sm text-tp-steel">
          Link your social media profiles
        </p>
      </div>

      <div className="rounded-[12px] border border-tp-hairline bg-tp-canvas p-6">
        <div className="space-y-4">
          {SOCIAL_PLATFORMS.map((platform) => (
            <div key={platform.key}>
              <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-tp-steel">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: platform.color }}
                />
                {platform.label}
              </label>
              <div className="relative">
                <input
                  type="url"
                  value={links[platform.key]}
                  onChange={(e) => handleChange(platform.key, e.target.value)}
                  placeholder={platform.placeholder}
                  className={`h-11 w-full rounded-[8px] border bg-tp-input-bg px-3.5 pr-10 text-sm text-tp-ink outline-none transition-colors focus:ring-1 ${
                    errors[platform.key]
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                      : 'border-tp-input-border focus:border-tp-primary focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20'
                  }`}
                />
                {links[platform.key] && !errors[platform.key] && (
                  <a
                    href={links[platform.key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-tp-steel transition-colors hover:text-tp-primary"
                  >
                    <FiExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              {errors[platform.key] && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-1 text-xs text-red-500"
                >
                  {errors[platform.key]}
                </motion.p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
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
