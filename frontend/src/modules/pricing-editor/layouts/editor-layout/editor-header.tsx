import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEditorValue } from '../../hooks/useEditorValue';
import { downloadYaml } from '../../services/export.service';
import { getClearEditorValue } from '../../services/clear.service';
import { dropdownVariants, transitionFast } from '../../../core/utils/motion-variants';
import { useRouter } from '../../../core/hooks/useRouter';
import { ensureSyntaxVersion31 } from '../../services/pricing2yaml';
import type { EditorMode } from '../../contexts/editorValueContext';
import ConfirmModal from '../../../core/components/confirm-modal';

interface Props {
  onShareLink: () => void;
  onImport: () => void;
}

export default function EditorHeader({ onShareLink, onImport }: Props) {
  const router = useRouter();
  const { editorValue, setEditorValue, editorMode, setEditorMode, isDirty, setIsDirty, saveDraft } = useEditorValue();
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [originalValue, setOriginalValue] = useState('');
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState<EditorMode | null>(null);

  useEffect(() => {
    if (originalValue === '' && editorValue) {
      setOriginalValue(editorValue);
    }
  }, [editorValue, originalValue]);

  useEffect(() => {
    if (!fileMenuOpen && !exportMenuOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [fileMenuOpen, exportMenuOpen]);

  const handleDownload = () => {
    try {
      downloadYaml(editorValue);
      setExportMenuOpen(false);
    } catch {
      // Error downloading yaml
    }
  };

  const handleModeToggle = (mode: EditorMode) => {
    if (mode === editorMode) return;
    if (editorMode === 'visual' && isDirty) {
      setPendingMode(mode);
      setShowUnsavedConfirm(true);
      return;
    }
    if (mode === 'visual') {
      setEditorValue(ensureSyntaxVersion31(editorValue));
    }
    setEditorMode(mode);
  };

  const handleConfirmSave = () => {
    saveDraft();
    if (pendingMode === 'visual') {
      setEditorValue(ensureSyntaxVersion31(editorValue));
    }
    setEditorMode(pendingMode!);
    setShowUnsavedConfirm(false);
    setPendingMode(null);
  };

  const handleConfirmDiscard = () => {
    setIsDirty(false);
    if (pendingMode === 'visual') {
      setEditorValue(ensureSyntaxVersion31(editorValue));
    }
    setEditorMode(pendingMode!);
    setShowUnsavedConfirm(false);
    setPendingMode(null);
  };

  return (
    <>
    <header className="sticky top-0 z-40 grid min-h-12 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 border-b border-white/10 bg-tp-surface-code px-3 py-2 sm:flex sm:h-12 sm:flex-nowrap sm:px-4 sm:py-0">
      {/* Left: Logo + back */}
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="cursor-pointer text-xs font-semibold tracking-[0.22em] text-white/60 transition-colors hover:text-white"
        >
          SPHERE
        </button>
        <span className="hidden text-white/20 md:inline">/</span>
        <span className="hidden truncate text-xs text-white/40 md:inline">Pricing2Yaml Editor</span>
      </div>

      {/* Center: Mode toggle */}
      <div className="col-span-3 row-start-2 justify-self-center sm:absolute sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2">
        <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
          {(['code', 'visual'] as EditorMode[]).map((mode) => {
            const isActive = editorMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => handleModeToggle(mode)}
                className="relative cursor-pointer rounded-md px-3 py-1 text-[11px] font-medium transition-colors"
              >
                {isActive && (
                  <motion.span
                    layoutId="editor-mode-bg"
                    className="absolute inset-0 rounded-md bg-white/15"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={`relative z-10 ${isActive ? 'text-white' : 'text-white/40 hover:text-white/60'}`}>
                  {mode === 'code' ? 'Code' : 'Visual'}
                  {mode === 'visual' && isDirty && (
                    <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Action buttons */}
      <div className="col-start-3 row-start-1 ml-auto flex items-center gap-0.5 sm:gap-1">
        {/* File menu */}
        <div ref={fileMenuRef} className="relative">
          <button
            type="button"
            onClick={() => { setFileMenuOpen(prev => !prev); setExportMenuOpen(false); }}
            className="cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white sm:px-3"
          >
            File
          </button>
          <AnimatePresence>
            {fileMenuOpen && (
              <motion.div
                variants={dropdownVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={transitionFast}
                className="absolute left-0 top-full z-50 mt-1 w-[180px] rounded-lg border border-white/10 bg-tp-surface-code py-1 shadow-elevation-4"
              >
                <button
                  type="button"
                  onClick={() => { setEditorValue(originalValue); setFileMenuOpen(false); }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => { onImport(); setFileMenuOpen(false); }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Import YAML
                </button>
                <button
                  type="button"
                  onClick={() => { setEditorValue(getClearEditorValue()); setFileMenuOpen(false); }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                  </svg>
                  Clear
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Export menu */}
        <div ref={exportMenuRef} className="relative">
          <button
            type="button"
            onClick={() => { setExportMenuOpen(prev => !prev); setFileMenuOpen(false); }}
            className="cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white sm:px-3"
          >
            Export
          </button>
          <AnimatePresence>
            {exportMenuOpen && (
              <motion.div
                variants={dropdownVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={transitionFast}
                className="absolute right-0 top-full z-50 mt-1 w-[180px] rounded-lg border border-white/10 bg-tp-surface-code py-1 shadow-elevation-4"
              >
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download YAML
                </button>
                <button
                  type="button"
                  onClick={() => { onShareLink(); setExportMenuOpen(false); }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                  Share Link
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Documentation */}
        <button
          type="button"
          onClick={() => window.open('https://sphere-docs.vercel.app/docs/2.0.1/api/pricing-description-languages/Pricing2Yaml/the-pricing2yaml-syntax', '_blank')}
          className="cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white sm:px-3"
        >
          Docs
        </button>
      </div>
    </header>

      <AnimatePresence>
        {showUnsavedConfirm && (
          <ConfirmModal
            message="You have unsaved changes in the visual editor. If you switch to code view without saving, your changes will be lost."
            onConfirm={handleConfirmSave}
            onCancel={handleConfirmDiscard}
            confirmLabel="Save changes"
            cancelLabel="Discard changes"
          />
        )}
      </AnimatePresence>
    </>
  );
}
