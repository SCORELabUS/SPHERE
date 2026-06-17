import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCommand, FiSun, FiMoon, FiSearch } from 'react-icons/fi';
import { useMode } from '../../hooks/useTheme';

interface Command {
  id: string;
  label: string;
  description: string;
  shortcut: string[];
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

const isMac =
  typeof navigator !== 'undefined' &&
  navigator.platform.toUpperCase().indexOf('MAC') >= 0;

function formatKey(key: string): string {
  if (key === 'mod') return isMac ? '\u2318' : 'Ctrl';
  return key.toUpperCase();
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { mode, setMode } = useMode();

  const commands: Command[] = useMemo(
    () => [
      {
        id: 'command-palette',
        label: 'Command palette',
        description: 'Open the command palette',
        shortcut: ['mod', 'k'],
        icon: FiCommand,
        action: () => setOpen(true),
      },
      {
        id: 'toggle-theme',
        label: 'Toggle theme (Upcoming)',
        description: 'Switch between light and dark mode',
        shortcut: ['mod', 'j'],
        icon: mode === 'dark' ? FiSun : FiMoon,
        action: () => setMode(mode === 'dark' ? 'light' : 'dark'),
      },
    ],
    [mode, setMode],
  );

  const filtered = useMemo(() => {
    if (!search) return commands;
    const q = search.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q),
    );
  }, [commands, search]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      cmd.action();
      setOpen(false);
      setSearch('');
      setSelectedIndex(0);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      if (e.key === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setMode(mode === 'dark' ? 'light' : 'dark');
        return;
      }

      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setSearch('');
        setSelectedIndex(0);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex]);
        }
        return;
      }
    },
    [open, filtered, selectedIndex, executeCommand, mode, setMode],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (listRef.current && filtered.length > 0) {
      const item = listRef.current.children[selectedIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, filtered]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-tp-hairline bg-tp-surface px-2.5 py-1.5 text-xs text-tp-steel transition-colors hover:bg-tp-canvas hover:text-tp-ink"
      >
        <FiCommand className="h-3.5 w-3.5" />
        <span className="hidden text-[11px] font-medium md:inline">K</span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-tp-ink/40 backdrop-blur-sm"
                onClick={() => {
                  setOpen(false);
                  setSearch('');
                  setSelectedIndex(0);
                }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="relative z-10 flex w-[90vw] max-w-150 flex-col overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas shadow-elevation-4"
              >
                {/* Search */}
                <div className="flex items-center gap-3 border-b border-tp-hairline px-4 py-3">
                  <FiSearch className="h-4 w-4 shrink-0 text-tp-ink" />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search commands..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-tp-ink placeholder-tp-muted outline-none"
                  />
                  <kbd className="hidden shrink-0 rounded-md border border-tp-hairline bg-tp-surface px-1.5 py-0.5 text-[10px] font-medium text-tp-ink sm:inline">
                    ESC
                  </kbd>
                </div>

                {/* List */}
                <div ref={listRef} className="max-h-72 overflow-y-auto px-2 py-2">
                  {filtered.length === 0 ? (
                    <p className="py-8 text-center text-sm text-tp-muted">
                      No commands found
                    </p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {filtered.map((cmd, i) => {
                        const Icon = cmd.icon;
                        return (
                          <button
                            key={cmd.id}
                            type="button"
                            onClick={() => executeCommand(cmd)}
                            onMouseEnter={() => setSelectedIndex(i)}
                            className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              i === selectedIndex
                                ? 'bg-tp-surface text-tp-ink'
                                : 'text-tp-slate hover:bg-tp-surface hover:text-tp-ink'
                            }`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tp-surface text-tp-ink">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-tp-ink">
                                {cmd.label}
                              </p>
                              <p className="text-xs text-tp-ink">
                                {cmd.description}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {cmd.shortcut.map((key, j) => (
                                <kbd
                                  key={j}
                                  className="rounded-md border border-tp-hairline bg-tp-surface px-1.5 py-0.5 text-[10px] font-medium text-tp-ink"
                                >
                                  {formatKey(key)}
                                </kbd>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-tp-hairline px-4 py-2.5">
                  <div className="flex items-center gap-3 text-[11px] text-tp-ink">
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-tp-hairline bg-tp-surface px-1 py-0.5 text-[9px]">
                        ↑↓
                      </kbd>
                      navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-tp-hairline bg-tp-surface px-1 py-0.5 text-[9px]">
                        ↵
                      </kbd>
                      select
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-tp-hairline bg-tp-surface px-1 py-0.5 text-[9px]">
                        esc
                      </kbd>
                      close
                    </span>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
