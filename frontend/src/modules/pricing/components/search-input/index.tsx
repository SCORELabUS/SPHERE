import { useState, type KeyboardEvent } from 'react';

interface Props {
  placeholder?: string;
  onSearch: (value: string) => void;
}

export default function SearchInput({ placeholder = 'Search...', onSearch }: Props) {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearch(value.trim());
    }
  };

  return (
    <div className="relative flex items-center">
      <svg
        className="absolute left-3 h-4 w-4 text-tp-muted"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg pl-9 pr-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => { setValue(''); onSearch(''); }}
          className="absolute right-2.5 cursor-pointer rounded p-0.5 text-tp-muted transition-colors hover:text-tp-ink"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
