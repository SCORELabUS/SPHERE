import { useState } from 'react';
import { motion } from 'framer-motion'

import Changelog from './components/changelog';
import { PIIP_CHANGELOG } from './data/piip';
import { SPHERE_CHANGELOG } from './data/sphere'

enum ChangelogTabs {
  SPHERE = 'sphere',
  PricingIntelligence = 'pricing-intelligence'
}

const CHANGELOG_TABS = [
  {
    id: ChangelogTabs.SPHERE,
    label: 'SPHERE',
  },
  { id: ChangelogTabs.PricingIntelligence, label: 'Pricing Intelligence' },
] as const;


export default function ChangelogPage() {
  const [currentTab, setCurrentTab] = useState<string>(ChangelogTabs.SPHERE);

  return (
    <section className="px-16">
      <nav className="mb-6 flex gap-1 border-b border-tp-hairline">
        {CHANGELOG_TABS.map(changelogTab => (
          <button
            key={changelogTab.id}
            onClick={() => setCurrentTab(changelogTab.id)}
            className={`relative cursor-pointer px-4 py-2.5 text-sm font-medium transition-colors ${currentTab === changelogTab.id ? 'text-tp-primary' : 'text-tp-steel hover:text-tp-ink'}`}
          >
            {changelogTab.label}
            {currentTab === changelogTab.id && <motion.div layoutId="collection-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-tp-primary" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}

          </button>
        ))}
      </nav>

      <div>
        {currentTab === ChangelogTabs.SPHERE && <Changelog releases={SPHERE_CHANGELOG} />}
        {currentTab === ChangelogTabs.PricingIntelligence && <Changelog releases={PIIP_CHANGELOG} />}
      </div>
    </section>
  );
}
