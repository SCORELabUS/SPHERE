import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Iconify from '../../../core/components/iconify';
import { useAuth } from '../../../auth/hooks/useAuth';

export interface UserSearchResult {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  settings?: {
    avatar?: string;
    avatarBgColor?: string;
    avatarFgColor?: string;
  };
}

interface UserSearchInputProps {
  selectedUsers: UserSearchResult[];
  onUsersChange: (users: UserSearchResult[]) => void;
  placeholder?: string;
  maxUsers?: number;
}

const BASE_URL = import.meta.env.VITE_API_URL;
const DEBOUNCE_MS = 500;
const MIN_CHARS = 4;

export default function UserSearchInput({
  selectedUsers,
  onUsersChange,
  placeholder = 'Search users by username...',
  maxUsers = 20,
}: UserSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedUsersRef = useRef(selectedUsers);
  const fetchRef = useRef<ReturnType<typeof useAuth>['fetchWithInterceptor']>(null!);
  const tokenRef = useRef<string | null | undefined>(undefined);
  const { fetchWithInterceptor, authUser } = useAuth();

  selectedUsersRef.current = selectedUsers;
  fetchRef.current = fetchWithInterceptor;
  tokenRef.current = authUser?.token;

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

  const searchUsers = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < MIN_CHARS) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetchRef.current(`${BASE_URL}/users?q=${encodeURIComponent(searchQuery)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const filtered = data.filter(
          (user: UserSearchResult) => !selectedUsersRef.current.some((u) => u.id === user.id)
        );
        setResults(filtered);
        setHighlightedIndex(0);
      }
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length >= MIN_CHARS) {
      debounceRef.current = setTimeout(() => {
        searchUsers(query);
      }, DEBOUNCE_MS);
    } else {
      setResults([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, searchUsers]);

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

  const handleSelect = (user: UserSearchResult) => {
    if (!selectedUsers.some((u) => u.id === user.id)) {
      onUsersChange([...selectedUsers, user]);
    }
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setHighlightedIndex(0);
    inputRef.current?.focus();
  };

  const handleRemove = (userId: string) => {
    onUsersChange(selectedUsers.filter((u) => u.id !== userId));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen && results.length > 0) {
        setIsOpen(true);
      }
      setHighlightedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) {
        const indexToSelect = highlightedIndex >= 0 ? highlightedIndex : 0;
        handleSelect(results[indexToSelect]);
      }
    } else if (e.key === 'Backspace' && query === '' && selectedUsers.length > 0) {
      handleRemove(selectedUsers[selectedUsers.length - 1].id);
    }
  };

  const dropdownContent =
    isOpen && results.length > 0 ? (
      <div style={dropdownStyle} className="max-h-60 overflow-y-auto rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4">
        {results.map((user, index) => (
          <button
            key={user.id}
            type="button"
            onClick={() => handleSelect(user)}
            onMouseEnter={() => setHighlightedIndex(index)}
            className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors ${
              index === highlightedIndex ? 'bg-tp-surface' : ''
            }`}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-tp-primary/10 text-xs font-medium text-tp-primary">
              {user.firstName.charAt(0)}
              {user.lastName.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-medium text-tp-ink">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-tp-steel">@{user.username}</p>
            </div>
          </button>
        ))}
      </div>
    ) : isOpen && query.length >= MIN_CHARS && !isSearching && results.length === 0 ? (
      <div style={dropdownStyle} className="w-full rounded-lg border border-tp-hairline bg-tp-canvas py-4 text-center shadow-elevation-4">
        <p className="text-sm text-tp-steel">No users found</p>
      </div>
    ) : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-tp-hairline bg-tp-canvas px-3 py-2 focus-within:border-tp-primary focus-within:ring-1 focus-within:ring-tp-primary/20">
        {selectedUsers.map((user) => (
          <span
            key={user.id}
            className="flex items-center gap-1 rounded-full bg-tp-surface px-2 py-0.5 text-xs font-medium text-tp-ink"
          >
            {user.username}
            <button
              type="button"
              onClick={() => handleRemove(user.id)}
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
            if (results.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={selectedUsers.length === 0 ? placeholder : ''}
          disabled={selectedUsers.length >= maxUsers}
          className="min-w-hero flex-1 bg-transparent text-sm text-tp-ink outline-none placeholder:text-tp-muted"
        />

        {isSearching && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-tp-primary border-t-transparent" />
        )}
      </div>

      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
}
