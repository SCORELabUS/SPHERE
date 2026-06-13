import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Iconify from '../../core/components/iconify';
import { useOrganizationsApi } from '../../organization/api/organizationsApi';

export interface OrgSearchResult {
  id: string;
  name: string;
  displayName: string;
  avatar?: string | null;
}

interface OrganizationSearchInputProps {
  selectedOrgs: OrgSearchResult[];
  onOrgsChange: (orgs: OrgSearchResult[]) => void;
  placeholder?: string;
}

export default function OrganizationSearchInput({
  selectedOrgs,
  onOrgsChange,
  placeholder = 'Search organizations...',
}: OrganizationSearchInputProps) {
  const [query, setQuery] = useState('');
  const [allOrgs, setAllOrgs] = useState<OrgSearchResult[]>([]);
  const [results, setResults] = useState<OrgSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedOrgsRef = useRef(selectedOrgs);
  const { getMyOrganizations } = useOrganizationsApi();
  const getMyOrgsRef = useRef(getMyOrganizations);
  getMyOrgsRef.current = getMyOrganizations;

  selectedOrgsRef.current = selectedOrgs;

  const updateDropdownPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: 9999,
      });
    }
  }, []);

  const loadOrgs = useCallback(async () => {
    if (allOrgs.length > 0) return;
    setIsLoading(true);
    try {
      const data = await getMyOrgsRef.current({ limit: 100 });
      const orgList = Array.isArray(data) ? data : data.items || [];
      setAllOrgs(
        orgList.map((o) => ({
          id: o.id,
          name: o.name,
          displayName: o.displayName,
          avatar: o.avatar,
        }))
      );
    } catch {
      setAllOrgs([]);
    } finally {
      setIsLoading(false);
    }
  }, [allOrgs.length]);

  const filterOrgs = useCallback(
    (searchQuery: string) => {
      const q = searchQuery.toLowerCase();
      const filtered = allOrgs.filter(
        (org) =>
          !selectedOrgsRef.current.some((s) => s.id === org.id) &&
          (org.name.toLowerCase().includes(q) ||
            org.displayName.toLowerCase().includes(q))
      );
      setResults(filtered);
      setHighlightedIndex(0);
    },
    [allOrgs]
  );

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      filterOrgs(query);
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, filterOrgs]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
    }
  }, [isOpen, updateDropdownPosition]);

  const handleSelect = (org: OrgSearchResult) => {
    if (!selectedOrgs.some((o) => o.id === org.id)) {
      onOrgsChange([...selectedOrgs, org]);
    }
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setHighlightedIndex(0);
  };

  const handleRemove = (orgId: string) => {
    onOrgsChange(selectedOrgs.filter((o) => o.id !== orgId));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen && results.length > 0) setIsOpen(true);
      setHighlightedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) {
        handleSelect(results[highlightedIndex >= 0 ? highlightedIndex : 0]);
      }
    } else if (e.key === 'Backspace' && query === '' && selectedOrgs.length > 0) {
      handleRemove(selectedOrgs[selectedOrgs.length - 1].id);
    }
  };

  const dropdownContent =
    isOpen && results.length > 0 ? (
      <div
        style={dropdownStyle}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-60 overflow-y-auto rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4"
      >
        {results.map((org, index) => (
          <button
            key={org.id}
            type="button"
            onClick={() => handleSelect(org)}
            onMouseEnter={() => setHighlightedIndex(index)}
            className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors ${
              index === highlightedIndex ? 'bg-tp-surface' : ''
            }`}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-tp-primary/10 text-xs font-medium text-tp-primary">
              {org.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-tp-ink">{org.displayName}</p>
              <p className="text-xs text-tp-steel">@{org.name}</p>
            </div>
          </button>
        ))}
      </div>
    ) : isOpen && query.length > 0 && !isLoading && results.length === 0 ? (
      <div
        style={dropdownStyle}
        className="w-full rounded-lg border border-tp-hairline bg-tp-canvas py-4 text-center shadow-elevation-4"
      >
        <p className="text-sm text-tp-steel">No organizations found</p>
      </div>
    ) : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-tp-hairline bg-tp-canvas px-3 py-2 focus-within:border-tp-primary focus-within:ring-1 focus-within:ring-tp-primary/20">
        {selectedOrgs.map((org) => (
          <span
            key={org.id}
            className="flex items-center gap-1 rounded-full bg-tp-surface px-2 py-0.5 text-xs font-medium text-tp-ink"
          >
            {org.displayName}
            <button
              type="button"
              onClick={() => handleRemove(org.id)}
              className="cursor-pointer text-tp-steel hover:text-tp-ink"
            >
              <Iconify icon="mdi:close" width={12} />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            filterOrgs(query);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={selectedOrgs.length === 0 ? placeholder : ''}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-tp-ink outline-none placeholder:text-tp-muted"
        />

        {isLoading && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-tp-primary border-t-transparent" />
        )}
      </div>

      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
}
