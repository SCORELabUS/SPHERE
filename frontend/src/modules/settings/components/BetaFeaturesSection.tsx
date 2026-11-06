import { useState } from 'react';
import { motion } from 'framer-motion';
import { FiAlertTriangle, FiLoader } from 'react-icons/fi';
import { useUserSettingsApi, type UserSettings } from '../api/userSettingsApi';
import { BETA_FEATURES, type BetaFeature } from '../../beta/config/betaFeatures';
import BetaBadge from '../../beta/components/beta-badge';

interface Props {
  settings: UserSettings;
  onUpdate: (partial: Partial<UserSettings>) => void;
}

export default function BetaFeaturesSection({ settings, onUpdate }: Props) {
  const api = useUserSettingsApi();
  const enabled = settings.settings?.betaFeatures === true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const features: [string, BetaFeature][] = Object.entries(BETA_FEATURES);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      onUpdate(await api.updateBetaFeatures(!enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update beta features');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium text-tp-ink">
          Beta features <BetaBadge />
        </h2>
        <p className="mt-0.5 text-sm text-tp-steel">
          Try new functionality before it is finished
        </p>
      </div>

      <div className="rounded-[12px] border border-tp-hairline bg-tp-canvas">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-sm font-medium text-tp-ink">Enable beta features</p>
            <p className="text-xs text-tp-steel">
              Show tabs, buttons and ORBIT capabilities that are still being built
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saving && <FiLoader className="h-4 w-4 animate-spin text-tp-steel" />}
            <motion.button
              whileTap={{ scale: 0.9 }}
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Enable beta features"
              onClick={toggle}
              disabled={saving}
              className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:cursor-not-allowed ${
                enabled ? 'bg-tp-primary' : 'bg-tp-hairline-strong'
              }`}
            >
              <motion.div
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm"
                animate={{ left: enabled ? 22 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </motion.button>
          </div>
        </div>

        <div className="flex items-start gap-3 border-t border-tp-hairline px-6 py-4">
          <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tp-sunshine-800" />
          <p className="text-xs text-tp-steel">
            Beta features may be incomplete, contain bugs, or change and disappear without notice.
            You can turn them off here at any time.
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-tp-severity-error">{error}</p>}

      <div>
        <h3 className="text-sm font-medium text-tp-ink">Available right now</h3>
        {features.length === 0 ? (
          <p className="mt-2 rounded-[12px] border border-dashed border-tp-hairline px-6 py-5 text-sm text-tp-steel">
            There are no beta features at the moment. New ones will show up here.
          </p>
        ) : (
          <ul className="mt-2 rounded-[12px] border border-tp-hairline bg-tp-canvas">
            {features.map(([key, feature], i) => (
              <li
                key={key}
                className={`px-6 py-4 ${i < features.length - 1 ? 'border-b border-tp-hairline' : ''}`}
              >
                <p className="text-sm font-medium text-tp-ink">
                  {feature.name} <span className="text-xs font-normal text-tp-steel">· {feature.area}</span>
                </p>
                <p className="text-xs text-tp-steel">{feature.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
