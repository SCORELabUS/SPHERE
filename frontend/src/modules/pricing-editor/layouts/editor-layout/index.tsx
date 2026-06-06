import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import EditorHeader from './editor-header';
import Main from '../main';
import { createUrlWithEncodedYaml, parseStringYamlToEncodedYaml } from '../../services/export.service';
import CopyToClipboardIcon from '../../../core/components/copy-icon';
import { EditorValueContext, EditorMode } from '../../contexts/editorValueContext';
import FileUpload from '../../../core/components/file-upload-input';
import customAlert from '../../../core/utils/custom-alert';
import { useCacheApi } from '../../components/pricing-renderer/api/cacheApi';
import { v4 as uuidv4 } from 'uuid';
import { serializeDraftToYaml } from '../../services/pricing2yaml';
import type { PricingDraft } from '../../services/pricing2yaml';

export default function EditorLayout({ children }: { children?: React.ReactNode }) {
  const [sharedLinkModalOpen, setSharedLinkModalOpen] = useState(false);
  const [importModalOpen, setImportLinkModalOpen] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const [editorMode, setEditorMode] = useState<EditorMode>('code');
  const [tabValue, setTabValue] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingVisualDraft, setPendingVisualDraft] = useState<PricingDraft | null>(null);

  const { setInCache } = useCacheApi();

  const saveDraft = useCallback(() => {
    if (pendingVisualDraft) {
      const newYaml = serializeDraftToYaml(pendingVisualDraft);
      setEditorValue(newYaml);
      setIsDirty(false);
      setPendingVisualDraft(null);
    }
  }, [pendingVisualDraft, setEditorValue]);

  const renderSharedLink = () => {
    setSharedLinkModalOpen(true);
  };

  const handleSharedLinkClose = () => {
    setSharedLinkModalOpen(false);
  };

  const renderYamlImport = () => {
    setImportLinkModalOpen(true);
  };

  const handleYamlImportClose = () => {
    setImportLinkModalOpen(false);
  };

  const handleCopyToClipboard = () => {
    if (sharedLinkModalOpen) {
      if (tabValue === 1) {
        const encodedPricing = parseStringYamlToEncodedYaml(editorValue);
        return createUrlWithEncodedYaml(encodedPricing);
      } else {
        const urlParams = new URLSearchParams(window.location.search);
        const assignedId = urlParams.get('pricing') ?? uuidv4();
        const encodedPricing = parseStringYamlToEncodedYaml(editorValue);
        setInCache(assignedId, encodedPricing, 24 * 60 * 60).catch(error => {
          customAlert(`Error saving link in cache: ${error}`, 'error');
        });
        return createUrlWithEncodedYaml(assignedId);
      }
    }
    return '';
  };

  const onSubmitImport = (file: File) => {
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditorValue(reader.result as string);
      };
      reader.readAsText(file);
    } else {
      customAlert('No file selected', 'warning');
    }
  };

  return (
    <EditorValueContext.Provider value={{ editorValue, setEditorValue, editorMode, setEditorMode, isDirty, setIsDirty, pendingVisualDraft, setPendingVisualDraft, saveDraft }}>
      <div className="flex h-dvh flex-col bg-tp-surface-code">
        <EditorHeader onShareLink={renderSharedLink} onImport={renderYamlImport} />
        <Main>{children}</Main>
      </div>

      {/* Share Link Modal */}
      <AnimatePresence>
        {sharedLinkModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
            role="dialog"
            aria-modal="true"
            onClick={handleSharedLinkClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-[500px] rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-center font-display text-lg font-semibold text-tp-ink">
                Share your pricing
              </h2>
              <p className="mt-2 text-center text-sm text-tp-steel">
                Share this link to let others view and edit their own version
              </p>

              <div className="mt-6 flex justify-center gap-1 rounded-lg bg-tp-surface p-1">
                {(['short', 'full'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTabValue(type === 'short' ? 0 : 1)}
                    className={`relative flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      (tabValue === 0 && type === 'short') || (tabValue === 1 && type === 'full')
                        ? 'bg-tp-canvas text-tp-ink shadow-sm'
                        : 'text-tp-steel hover:text-tp-slate'
                    }`}
                  >
                    {type === 'short' ? 'Short encoding' : 'Full encoding'}
                  </button>
                ))}
              </div>

              {tabValue === 1 ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
                  Large YAML may produce URLs that exceed browser limits.
                </p>
              ) : (
                <p className="mt-3 rounded-lg bg-tp-surface px-3 py-2 text-center text-xs text-tp-steel">
                  Short links expire after 24 hours.
                </p>
              )}

              <div className="mt-4 flex justify-center">
                <CopyToClipboardIcon value={handleCopyToClipboard()} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {importModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
            role="dialog"
            aria-modal="true"
            onClick={handleYamlImportClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-[28rem] rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
              onClick={(e) => e.stopPropagation()}
            >
              <FileUpload onSubmit={onSubmitImport} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </EditorValueContext.Provider>
  );
}
