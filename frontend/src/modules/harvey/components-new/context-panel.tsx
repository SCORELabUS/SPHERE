import { useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { ContextInputType, PricingContextItem, UrlContextItemInput } from '../types/types';
import ContextItem from './context-item';

interface Props {
  items: PricingContextItem[];
  detectedUrls: string[];
  isPlayground: boolean;
  onAdd: (input: ContextInputType) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onOpenSearch: () => void;
}

export default function ContextPanel({ items, detectedUrls, isPlayground, onAdd, onRemove, onClear, onOpenSearch }: Props) {
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const availableDetected = useMemo(
    () => detectedUrls.filter(url => !items.some(item => item.kind === 'url' && item.value === url)),
    [detectedUrls, items]
  );

  const handleAddUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError('Enter a URL to add it to the context.');
      return;
    }

    try {
      const normalized = new URL(trimmed).href;
      const urlItem: UrlContextItemInput = {
        kind: 'url',
        url: normalized,
        label: normalized,
        value: normalized,
        origin: 'user',
        transform: 'not-started',
      };
      onAdd(urlItem);
      setUrlInput('');
      setUrlError(null);
    } catch {
      setUrlError('Enter a valid http(s) URL.');
    }
  };

  return (
    <div className="flex h-full flex-col bg-tp-canvas">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-tp-hairline px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-tp-ink">Pricing Context</h2>
          <p className="text-[11px] text-tp-steel">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer rounded-md px-2 py-1 text-[11px] text-tp-muted transition-colors hover:bg-red-50 hover:text-red-500"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-tp-surface">
              <svg className="h-5 w-5 text-tp-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-xs text-tp-steel">No context items yet</p>
            <p className="mt-1 text-[11px] text-tp-muted">Add URLs or upload YAML files</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {items.map(item => (
                <ContextItem key={item.id} item={item} onRemove={onRemove} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Detected URLs */}
      {availableDetected.length > 0 && (
        <div className="border-t border-tp-hairline px-3 py-2">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-tp-steel">
            Detected in question
          </p>
          <div className="flex flex-wrap gap-1">
            {availableDetected.map(url => (
              <button
                key={url}
                type="button"
                onClick={() =>
                  onAdd({
                    kind: 'url',
                    url,
                    label: url,
                    value: url,
                    transform: 'not-started',
                    origin: 'detected',
                  })
                }
                className="cursor-pointer truncate rounded-full border border-tp-hairline bg-tp-surface px-2 py-0.5 text-[10px] text-tp-slate transition-colors hover:border-tp-primary/30 hover:text-tp-primary"
              >
                {url.length > 30 ? url.slice(0, 30) + '...' : url}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add URL */}
      {!isPlayground && (
        <div className="border-t border-tp-hairline px-3 py-3">
          <div className="flex gap-1.5">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddUrl(); } }}
              placeholder="https://..."
              className="flex-1 rounded-md border border-tp-input-border bg-tp-input-bg px-2.5 py-1.5 text-xs text-tp-ink placeholder-tp-muted focus:border-tp-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddUrl}
              className="shrink-0 cursor-pointer rounded-md bg-tp-primary px-2.5 py-1.5 text-xs font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
            >
              Add
            </button>
          </div>
          {urlError && (
            <p className="mt-1.5 text-[11px] text-red-500">{urlError}</p>
          )}

          {/* Action buttons */}
          <div className="mt-2 flex gap-1.5">
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Upload
              <input
                type="file"
                accept=".yaml,.yml"
                multiple
                hidden
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) {
                    Array.from(files).forEach(file => {
                      file.text().then(content => {
                        if (content.trim()) {
                          onAdd({ kind: 'yaml', label: file.name, value: content, origin: 'user' });
                        }
                      });
                    });
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex cursor-pointer flex-1 items-center justify-center gap-1.5 rounded-md border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              Search
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
