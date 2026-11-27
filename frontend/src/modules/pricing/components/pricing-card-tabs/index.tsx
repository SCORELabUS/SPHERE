import { motion } from 'framer-motion';
import type { Tab } from '../../types/card';

export default function PricingCardTabs({ tab, setTab, showSettingsTab, showVersions = true }: { tab: Tab; setTab: (tab: Tab) => void; showSettingsTab: boolean; showVersions?: boolean }) {
  return (
        <div className="mb-6 border-b border-tp-hairline">
          <div
            className="mb-2 flex gap-2 overflow-x-auto pb-2 md:hidden"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {(
              [
                ['overview', 'Overview'],
                ['analytics', 'Analytics'],
                ['config-space', 'Config Space'],
                ...(showVersions ? [['versions', 'Versions'] as const] : []),
                ...(showSettingsTab ? [['settings', 'Settings'] as const] : []),
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  tab === k
                    ? 'bg-tp-primary text-tp-on-primary shadow-sm'
                    : 'bg-tp-surface text-tp-steel hover:bg-tp-hairline hover:text-tp-ink'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="hidden gap-1 md:flex">
            {(
              [
                ['overview', 'Overview'],
                ['analytics', 'Analytics'],
                ['config-space', 'Configuration Space'],
                ...(showVersions ? [['versions', 'Versions'] as const] : []),
                ...(showSettingsTab ? [['settings', 'Settings'] as const] : []),
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`relative cursor-pointer whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${tab === k ? 'text-tp-primary' : 'text-tp-steel hover:text-tp-ink'}`}
              >
                {l}
                {tab === k && (
                  <motion.div
                    layoutId="pricing-tab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-tp-primary"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

  );
}
