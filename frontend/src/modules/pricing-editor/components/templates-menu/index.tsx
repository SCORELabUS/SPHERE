import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { FiChevronDown, FiFileText, FiGrid } from 'react-icons/fi';

import { dropdownVariants, transitionFast } from '../../../core/utils/motion-variants';
import {
  SECTION_ORDER,
  templatesShortcutLabel,
  type Pricing2YamlSnippet,
  type SnippetSection,
} from '../../services/pricing2yaml/snippets';

interface TemplatesMenuProps {
  snippets: readonly Pricing2YamlSnippet[];
  onSelect: (snippet: Pricing2YamlSnippet) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Disabled until the editor is mounted and can receive the snippet. */
  disabled?: boolean;
}

const SECTION_LABELS: Record<SnippetSection, string> = {
  features: 'Features',
  usageLimits: 'Usage limits',
  plans: 'Plans',
  addOns: 'Add-ons',
};

interface SnippetGroup {
  title: string;
  hint?: string;
  snippets: Pricing2YamlSnippet[];
}

/**
 * Lists the available templates so they can be discovered by browsing, next to
 * the prefix that inserts them without leaving the keyboard.
 */
export default function TemplatesMenu({
  snippets,
  onSelect,
  isOpen,
  onOpenChange,
  disabled = false,
}: Readonly<TemplatesMenuProps>): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onOpenChange]);

  // The menu is also opened from the editor shortcut, where the caret still
  // holds the focus, so the first entry is focused for keyboard navigation.
  useEffect(() => {
    if (isOpen) {
      focusItem(menuRef.current, 0);
    }
  }, [isOpen]);

  const groups = groupSnippets(snippets);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FiGrid className="h-3.5 w-3.5" />
        Templates
        <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-white/45">
          {templatesShortcutLabel()}
        </kbd>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={transitionFast}>
          <FiChevronDown className="h-3.5 w-3.5 text-white/40" />
        </motion.span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={menuRef}
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={transitionFast}
            role="menu"
            onKeyDown={event => handleMenuNavigation(event, menuRef.current)}
            className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-[290px] overflow-y-auto rounded-lg border border-white/10 bg-tp-surface-code py-1 shadow-elevation-4"
          >
            {groups.map(group => (
              <div key={group.title} className="py-0.5">
                <p className="flex items-center gap-1.5 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">
                  {group.title}
                  {group.hint && (
                    <span className="font-medium normal-case tracking-normal text-white/25">
                      {group.hint}
                    </span>
                  )}
                </p>
                {group.snippets.map(snippet => (
                  <button
                    key={snippet.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSelect(snippet);
                      onOpenChange(false);
                    }}
                    className="flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                  >
                    {snippet.kind === 'document' && (
                      <FiFileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-white/80">{snippet.label}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/35">
                        <span className="font-mono text-white/45">{snippet.prefix}</span>
                        <span className="truncate">{snippet.detail}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Moves the focus between entries, so the menu is usable from the keyboard. */
function handleMenuNavigation(
  event: React.KeyboardEvent<HTMLDivElement>,
  menu: HTMLDivElement | null
): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return;
  }

  const items = listItems(menu);
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;

  event.preventDefault();
  focusItem(menu, (current + step + items.length) % items.length);
}

function focusItem(menu: HTMLDivElement | null, index: number): void {
  listItems(menu)[index]?.focus();
}

function listItems(menu: HTMLDivElement | null): HTMLButtonElement[] {
  return menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : [];
}

/** Orders the templates the way the document itself is laid out. */
function groupSnippets(snippets: readonly Pricing2YamlSnippet[]): SnippetGroup[] {
  const groups: SnippetGroup[] = [];

  for (const section of SECTION_ORDER) {
    const sectionSnippets = snippets.filter(
      snippet => snippet.kind === 'block' && snippet.section === section
    );

    if (sectionSnippets.length > 0) {
      groups.push({ title: SECTION_LABELS[section], snippets: sectionSnippets });
    }
  }

  const documents = snippets.filter(snippet => snippet.kind === 'document');

  if (documents.length > 0) {
    groups.push({
      title: 'Whole pricing',
      hint: '· replaces the document',
      snippets: documents,
    });
  }

  return groups;
}
