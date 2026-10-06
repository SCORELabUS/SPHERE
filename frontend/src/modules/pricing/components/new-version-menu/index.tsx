import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FiCode, FiEdit3, FiUploadCloud } from 'react-icons/fi';

interface Props {
  onVisualEditor: () => void;
  onCodeEditor: () => void;
  onUploadFile: () => void;
}

interface Option {
  key: string;
  title: string;
  description: string;
  icon: ReactNode;
  onSelect: () => void;
}

export default function NewVersionMenu({ onVisualEditor, onCodeEditor, onUploadFile }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const options: Option[] = [
    {
      key: 'visual',
      title: 'Visual editor',
      description: 'Edit this pricing visually',
      icon: <FiEdit3 className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary" />,
      onSelect: onVisualEditor,
    },
    {
      key: 'code',
      title: 'Code editor',
      description: 'Edit the pricing YAML',
      icon: <FiCode className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary" />,
      onSelect: onCodeEditor,
    },
    {
      key: 'upload',
      title: 'Upload file',
      description: 'Add a version from a YAML file',
      icon: <FiUploadCloud className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary" />,
      onSelect: onUploadFile,
    },
  ];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-xs text-tp-ink transition-colors hover:bg-tp-surface focus:border-tp-primary focus:outline-none"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New version
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas p-1.5 shadow-elevation-3"
        >
          {options.map(option => (
            <button
              key={option.key}
              type="button"
              role="menuitem"
              onClick={() => {
                option.onSelect();
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left text-xs text-tp-ink hover:bg-tp-surface"
            >
              {option.icon}
              <span>
                <span className="block font-medium">{option.title}</span>
                <span className="mt-0.5 block text-[11px] text-tp-steel">{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
