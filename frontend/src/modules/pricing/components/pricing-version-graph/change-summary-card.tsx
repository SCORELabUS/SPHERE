import { format, parseISO } from 'date-fns';
import type { IconType } from 'react-icons';
import {
  FiCheckSquare,
  FiDollarSign,
  FiLayers,
  FiPackage,
  FiSettings,
  FiSliders,
} from 'react-icons/fi';
import type { SectionKey } from '../../utils/pricing-diff';
import type { SectionChanges } from '../../utils/change-summary';
import type { ChangesState } from './use-version-changes';

const SECTION_ICONS: Record<SectionKey, IconType> = {
  plans: FiLayers,
  features: FiCheckSquare,
  addOns: FiPackage,
  usageLimits: FiSliders,
};

/** Names shown under a section before "+N more". */
const NAMES_SHOWN = 3;

interface ChangeSummaryCardProps {
  pricingName: string;
  version: string;
  createdAt: string | null;
  /** "Changes since 1.0.0", or what a version with nothing before it starts with. */
  heading: string;
  /** Nothing to compare with: the sections list what it contains. */
  firstVersion: boolean;
  state: ChangesState;
  /** Where its top centre goes, inside the graph. */
  left: number;
  top: number;
}

function Count({ sign, value, className }: { sign: string; value: number; className: string }) {
  if (value === 0) return null;
  return (
    <span className={`font-mono text-[11px] font-semibold tabular-nums ${className}`}>
      {sign}
      {value}
    </span>
  );
}

function SectionRow({ section, firstVersion }: { section: SectionChanges; firstVersion: boolean }) {
  const Icon = SECTION_ICONS[section.key];
  const names = [
    ...section.added.map(name => ({ name, sign: '+', className: 'text-emerald-700' })),
    ...section.removed.map(name => ({ name, sign: '−', className: 'text-red-700' })),
    ...section.changed.map(name => ({ name, sign: '~', className: 'text-yellow-600' })),
  ];
  const hidden = names.length - NAMES_SHOWN;
  return (
    <li className="py-1">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-tp-steel" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs font-medium text-tp-ink">{section.label}</span>
        {firstVersion ? (
          <span className="font-mono text-[11px] font-semibold tabular-nums text-tp-slate">
            {section.added.length}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Count sign="+" value={section.added.length} className="text-emerald-700" />
            <Count sign="−" value={section.removed.length} className="text-red-700" />
            <Count sign="~" value={section.changed.length} className="text-yellow-600" />
          </span>
        )}
      </div>
      {!firstVersion && (
        <p className="ml-5.5 truncate text-[11px] leading-4 text-tp-steel">
          {names.slice(0, NAMES_SHOWN).map(({ name, sign, className }, index) => (
            <span key={`${sign}${name}`}>
              {index > 0 && ', '}
              <span className={className}>{sign}</span>
              {name}
            </span>
          ))}
          {hidden > 0 && ` +${hidden} more`}
        </p>
      )}
    </li>
  );
}

/**
 * What a version of the graph changed, shown while the viewer points at its dot:
 * features, usage limits, plans and add-ons added (+), removed (−) or changed (~),
 * the plans and add-ons whose price moved, and other fields. A first version
 * says what it starts with.
 */
export default function ChangeSummaryCard({
  pricingName,
  version,
  createdAt,
  heading,
  firstVersion,
  state,
  left,
  top,
}: ChangeSummaryCardProps) {
  return (
    <div
      role="tooltip"
      style={{ left, top }}
      className="pointer-events-none absolute z-30 w-72 -translate-x-1/2 rounded-xl border border-tp-hairline-strong bg-tp-canvas p-3 shadow-lg"
    >
      <p className="flex items-baseline gap-2 text-sm text-tp-ink">
        <span className="truncate font-medium">{pricingName}</span>
        <span className="shrink-0 font-mono">{version}</span>
        {createdAt && (
          <span className="ml-auto shrink-0 text-[11px] text-tp-steel">
            {format(parseISO(createdAt), 'PP')}
          </span>
        )}
      </p>
      <p className="mb-1.5 text-[11px] text-tp-steel">{heading}</p>

      {state.status === 'loading' || state.status === 'idle' ? (
        <div className="space-y-1.5 py-1" aria-label="Comparing">
          <div className="h-3 w-3/4 animate-pulse rounded bg-tp-surface" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-tp-surface" />
        </div>
      ) : state.status === 'error' ? (
        <p className="py-1 text-xs text-tp-steel">Could not compare this version.</p>
      ) : state.summary.isEmpty ? (
        <p className="py-1 text-xs text-tp-steel">
          {firstVersion ? 'Nothing in it yet.' : 'No pricing changes.'}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-tp-hairline">
            {state.summary.sections.map(section => (
              <SectionRow key={section.key} section={section} firstVersion={firstVersion} />
            ))}
          </ul>
          {!firstVersion && (state.summary.priceChanges.length > 0 || state.summary.otherFields > 0) && (
            <div className="mt-1 space-y-1 border-t border-tp-hairline pt-1.5 text-[11px] text-tp-slate">
              {state.summary.priceChanges.length > 0 && (
                <p className="flex items-center gap-2">
                  <FiDollarSign className="h-3.5 w-3.5 shrink-0 text-tp-steel" aria-hidden="true" />
                  <span className="truncate">
                    New price: {state.summary.priceChanges.join(', ')}
                  </span>
                </p>
              )}
              {state.summary.otherFields > 0 && (
                <p className="flex items-center gap-2">
                  <FiSettings className="h-3.5 w-3.5 shrink-0 text-tp-steel" aria-hidden="true" />
                  {state.summary.otherFields} other{' '}
                  {state.summary.otherFields === 1 ? 'field' : 'fields'} changed
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
