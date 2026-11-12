import type { IconType } from 'react-icons';
import { FiAlertTriangle, FiCheckSquare, FiLayers, FiPackage, FiSliders } from 'react-icons/fi';
import type { ChangeSummary } from '../../../pricing/utils/change-summary';
import type { SectionKey } from '../../../pricing/utils/pricing-diff';
import { removalsOf } from '../../../pricing/utils/proposal-summary';

const SECTION_ICONS: Record<SectionKey, IconType> = {
  plans: FiLayers,
  features: FiCheckSquare,
  addOns: FiPackage,
  usageLimits: FiSliders,
};

/** Names listed under a section before "+N more". */
const NAMES_SHOWN = 5;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What a proposal changes against the version it is based on: entries added
 * (+), removed (−) and changed (~) by section, prices that move and other
 * fields. Removing plans, features, add-ons or usage limits is called out,
 * since a merge would take them away from everyone who uses the pricing.
 */
export default function ProposalSummary({ summary, baseLabel }: { summary: ChangeSummary | null; baseLabel: string }) {
  if (!summary) {
    return (
      <p className="rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2 text-xs text-tp-steel">
        The changes against version {baseLabel} cannot be summarised: one of the two is not a YAML mapping.
      </p>
    );
  }
  if (summary.isEmpty) {
    return (
      <p className="rounded-lg border border-tp-severity-info-border bg-tp-severity-info-bg px-3 py-2 text-xs text-tp-ink">
        Nothing to propose: it is the same as version {baseLabel}.
      </p>
    );
  }

  const removals = removalsOf(summary);
  return (
    <section aria-label={`Changes against version ${baseLabel}`} className="space-y-2">
      <p className="text-xs text-tp-steel">Changes against version {baseLabel}, the latest public version:</p>
      {removals.length > 0 && (
        <p
          data-warning="removals"
          className="flex items-start gap-2 rounded-lg border border-tp-severity-warning-border bg-tp-severity-warning-bg px-3 py-2 text-xs text-tp-ink"
        >
          <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tp-severity-warning" />
          <span>
            <span className="font-semibold">This proposal removes </span>
            {removals.map((section, index) => (
              <span key={section.key}>
                {index > 0 && '; '}
                {section.label.toLowerCase()} {section.removed.join(', ')}
              </span>
            ))}
            . Merging it takes them away from everyone who uses this pricing.
          </span>
        </p>
      )}
      <ul className="divide-y divide-tp-hairline rounded-lg border border-tp-hairline">
        {summary.sections.map(section => {
          const Icon = SECTION_ICONS[section.key];
          const names = [
            ...section.added.map(name => ({ name, sign: '+', className: 'text-tp-severity-success' })),
            ...section.removed.map(name => ({ name, sign: '−', className: 'text-tp-severity-error' })),
            ...section.changed.map(name => ({ name, sign: '~', className: 'text-tp-severity-warning' })),
          ];
          const hidden = names.length - NAMES_SHOWN;
          return (
            <li key={section.key} className="px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-tp-steel" />
                <span className="flex-1 font-medium text-tp-ink">{section.label}</span>
                <span className="font-mono tabular-nums text-tp-slate">
                  {[
                    section.added.length ? `+${section.added.length}` : '',
                    section.removed.length ? `−${section.removed.length}` : '',
                    section.changed.length ? `~${section.changed.length}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </span>
              </div>
              <p className="ml-5.5 mt-0.5 break-words text-[11px] text-tp-steel">
                {names.slice(0, NAMES_SHOWN).map(({ name, sign, className }, index) => (
                  <span key={`${sign}${name}`}>
                    {index > 0 && ', '}
                    <span className={className}>{sign}</span>
                    {name}
                  </span>
                ))}
                {hidden > 0 && ` +${hidden} more`}
              </p>
            </li>
          );
        })}
        {summary.priceChanges.length > 0 && (
          <li className="px-3 py-2 text-xs text-tp-slate">Prices change: {summary.priceChanges.join(', ')}</li>
        )}
        {summary.otherFields > 0 && (
          <li className="px-3 py-2 text-xs text-tp-slate">{plural(summary.otherFields, 'other field')} change</li>
        )}
      </ul>
    </section>
  );
}
