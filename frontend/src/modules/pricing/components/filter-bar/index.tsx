import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

interface SliderFilter {
  label: string;
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

interface Props {
  ownerFilters: FilterOption[];
  sliderFilters?: SliderFilter[];
  selectedOwners: string[];
  onOwnersChange: (owners: string[]) => void;
  onClear: () => void;
}

export default function FilterBar({
  ownerFilters,
  sliderFilters = [],
  selectedOwners,
  onOwnersChange,
  onClear,
}: Props) {
  const [showOwners, setShowOwners] = useState(false);
  const [showSliders, setShowSliders] = useState(false);

  const hasActiveFilters = selectedOwners.length > 0 || sliderFilters.some(f => f.value[0] !== f.min || f.value[1] !== f.max);

  const toggleOwner = (owner: string) => {
    if (selectedOwners.includes(owner)) {
      onOwnersChange(selectedOwners.filter(o => o !== owner));
    } else {
      onOwnersChange([...selectedOwners, owner]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Owners filter */}
      {ownerFilters.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => { setShowOwners(!showOwners); setShowSliders(false); }}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedOwners.length > 0
                ? 'border-tp-primary/30 bg-tp-primary/5 text-tp-primary'
                : 'border-tp-hairline-strong bg-tp-canvas text-tp-slate hover:border-tp-hairline'
            }`}
          >
            Owner
            {selectedOwners.length > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tp-primary text-[9px] text-tp-on-primary">
                {selectedOwners.length}
              </span>
            )}
            <svg className={`h-3 w-3 transition-transform ${showOwners ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <AnimatePresence>
            {showOwners && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4"
              >
                <div className="max-h-48 overflow-y-auto">
                  {ownerFilters.map(owner => (
                    <label
                      key={owner.value}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-tp-surface"
                    >
                      <input
                        type="checkbox"
                        checked={selectedOwners.includes(owner.value)}
                        onChange={() => toggleOwner(owner.value)}
                        className="h-3.5 w-3.5 rounded border-tp-hairline-strong text-tp-primary focus:ring-tp-primary"
                      />
                      <span className="flex-1 truncate text-tp-slate">{owner.label}</span>
                      {owner.count !== undefined && (
                        <span className="text-[10px] text-tp-muted">{owner.count}</span>
                      )}
                    </label>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Slider filters */}
      {sliderFilters.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => { setShowSliders(!showSliders); setShowOwners(false); }}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              sliderFilters.some(f => f.value[0] !== f.min || f.value[1] !== f.max)
                ? 'border-tp-primary/30 bg-tp-primary/5 text-tp-primary'
                : 'border-tp-hairline-strong bg-tp-canvas text-tp-slate hover:border-tp-hairline'
            }`}
          >
            Ranges
            <svg className={`h-3 w-3 transition-transform ${showSliders ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <AnimatePresence>
            {showSliders && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-tp-hairline bg-tp-canvas p-3 shadow-elevation-4"
              >
                {sliderFilters.map(filter => (
                  <div key={filter.label} className="mb-3 last:mb-0">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-tp-slate">{filter.label}</span>
                      <span className="text-tp-muted">
                        {filter.value[0].toLocaleString()} – {filter.value[1].toLocaleString()}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="range"
                        min={filter.min}
                        max={filter.max}
                        value={filter.value[0]}
                        onChange={(e) => filter.onChange([Number(e.target.value), filter.value[1]])}
                        className="h-1 flex-1 cursor-pointer accent-tp-primary"
                      />
                      <input
                        type="range"
                        min={filter.min}
                        max={filter.max}
                        value={filter.value[1]}
                        onChange={(e) => filter.onChange([filter.value[0], Number(e.target.value)])}
                        className="h-1 flex-1 cursor-pointer accent-tp-primary"
                      />
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Clear button */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-tp-muted transition-colors hover:text-red-500"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Clear
        </button>
      )}
    </div>
  );
}
