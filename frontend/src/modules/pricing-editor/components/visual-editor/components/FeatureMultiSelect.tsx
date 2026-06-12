import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaXmark } from 'react-icons/fa6';
import { camelToTitle } from '../../pricing-renderer/shared/stringUtils';

export function FeatureMultiSelect({ availableFeatures, selectedFeatures, onChange }: {
  availableFeatures: string[];
  selectedFeatures: string[];
  onChange: (features: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() =>
    availableFeatures.filter(f =>
      !selectedFeatures.includes(f) && f.toLowerCase().includes(query.toLowerCase())
    ), [availableFeatures, selectedFeatures, query]);

  useEffect(() => { setHighlightIndex(0); }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectFeature = (feature: string) => {
    if (!selectedFeatures.includes(feature)) {
      onChange([...selectedFeatures, feature]);
    }
    setQuery('');
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const removeFeature = (feature: string) => {
    onChange(selectedFeatures.filter(f => f !== feature));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0 && showDropdown) {
        selectFeature(filtered[highlightIndex]);
      }
    } else if (e.key === 'Backspace' && query === '' && selectedFeatures.length > 0) {
      onChange(selectedFeatures.slice(0, -1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-600 dark:bg-slate-800">
        <AnimatePresence mode="popLayout">
          {selectedFeatures.map(feature => (
            <motion.span
              key={feature}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
            >
              {camelToTitle(feature)}
              <button
                type="button"
                onClick={() => removeFeature(feature)}
                className="cursor-pointer rounded-full p-0.5 transition-colors hover:bg-indigo-200 dark:hover:bg-indigo-800"
              >
                <FaXmark className="h-2.5 w-2.5" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedFeatures.length === 0 ? 'Search features...' : ''}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-slate-700 outline-none dark:text-slate-300"
        />
      </div>
      <AnimatePresence>
        {showDropdown && filtered.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800"
          >
            {filtered.map((feature, idx) => (
              <li
                key={feature}
                onMouseDown={(e) => { e.preventDefault(); selectFeature(feature); }}
                onMouseEnter={() => setHighlightIndex(idx)}
                className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
                  idx === highlightIndex
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {camelToTitle(feature)}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
