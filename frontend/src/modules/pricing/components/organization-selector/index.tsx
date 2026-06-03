import { useState, useRef, useEffect, useCallback } from 'react';
import { useOrganizationsApi, Organization } from '../../../organization/api/organizationsApi';
import { useAuth } from '../../../auth/hooks/useAuth';
import OrgAvatar from '../../../core/components/org-avatar';

interface OrganizationSelectorProps {
  value: Organization | null;
  onChange: (org: Organization | null) => void;
}

function flattenOrganizations(orgs: Organization[]): Organization[] {
  return orgs.reduce<Organization[]>((acc, org) => {
    acc.push(org);
    if (org.subOrganizations?.length) {
      acc.push(...flattenOrganizations(org.subOrganizations));
    }
    return acc;
  }, []);
}

export default function OrganizationSelector({ value, onChange }: OrganizationSelectorProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { authUser } = useAuth();
  const { getMyOrganizations } = useOrganizationsApi();

  useEffect(() => {
    if (!authUser.isAuthenticated || authUser.isLoading) return;

    setIsLoading(true);
    getMyOrganizations()
      .then(result => {
        const orgs = Array.isArray(result) ? result : result.items;
        setOrganizations(flattenOrganizations(orgs));
      })
      .catch(() => setOrganizations([]))
      .finally(() => setIsLoading(false));
  }, [authUser.isAuthenticated, authUser.isLoading]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const filtered = organizations.filter(org => {
    const query = search.toLowerCase();
    return (
      org.displayName.toLowerCase().includes(query) ||
      org.name.toLowerCase().includes(query)
    );
  });

  const handleSelect = useCallback((org: Organization) => {
    onChange(org);
    setIsOpen(false);
    setSearch('');
  }, [onChange]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSearch('');
  }, [onChange]);

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1 block text-sm text-slate-700">Organization</label>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-slate-400 cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {value && (
            <OrgAvatar
              name={value.displayName || value.name}
              avatar={value.avatar}
              avatarBgColor={value.avatarBgColor}
              avatarFgColor={value.avatarFgColor}
              isPersonal={value.isPersonal}
              size={20}
            />
          )}
          <span className={`block overflow-hidden text-ellipsis whitespace-nowrap ${value ? 'text-slate-900' : 'text-slate-400'}`}>
            {value
              ? value.displayName.length > 25
                ? `${value.displayName.slice(0, 22)}...`
                : value.displayName
              : 'Select an organization'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={e => { if (e.key === 'Enter') handleClear(e as any); }}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </span>
          )}
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search organizations..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-tp-primary"
            />
          </div>
          <div className="max-h-50 overflow-y-auto">
            {isLoading ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">
                {search ? 'No organizations found' : 'No organizations available'}
              </div>
            ) : (
              filtered.map(org => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => handleSelect(org)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 cursor-pointer ${
                    value?.id === org.id ? 'bg-tp-primary/5 text-tp-primary' : 'text-slate-700'
                  }`}
                >
                  <OrgAvatar
                    name={org.displayName || org.name}
                    avatar={org.avatar}
                    avatarBgColor={org.avatarBgColor}
                    avatarFgColor={org.avatarFgColor}
                    isPersonal={org.isPersonal}
                    size={24}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{org.displayName}</span>
                    <span className="text-xs text-slate-400">{org.name}</span>
                  </div>
                  {value?.id === org.id && (
                    <svg className="ml-auto h-4 w-4 text-tp-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
