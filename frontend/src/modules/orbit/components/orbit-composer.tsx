import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ChangeEvent } from 'react';
import { MdAttachFile, MdClose, MdInsertDriveFile } from 'react-icons/md';
import HarveyChatInput from '../../core/components/harvey-chat/harvey-chat-input';
import type { OrbitChat, OrbitPendingAttachment } from '../hooks/useOrbitChat';

const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.yml', '.yaml'];
const MAX_FILE_BYTES = 512 * 1024;

export interface OrbitComposerHandle {
  /** Opens the file picker, for an "import a file" shortcut elsewhere. */
  pickFile: () => void;
  focus: () => void;
}

interface Props {
  chat: OrbitChat;
  placeholder?: string;
}

/** The message box, with the file a message can carry. */
const OrbitComposer = forwardRef<OrbitComposerHandle, Props>(function OrbitComposer(
  { chat, placeholder = 'Ask ORBIT about your organizations, teams or pricings...' },
  ref
) {
  const [value, setValue] = useState('');
  const [attachment, setAttachment] = useState<OrbitPendingAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    pickFile: () => fileInputRef.current?.click(),
    focus: () => wrapperRef.current?.querySelector('textarea')?.focus(),
  }));

  const disabled = chat.availability !== 'available';

  const handleSend = useCallback(
    (text: string) => {
      if (disabled || chat.isSending) return;
      const sent = attachment;
      // The box empties at once; the message is already on its way.
      setValue('');
      setAttachment(null);
      void chat.send(text, sent);
    },
    [attachment, chat, disabled]
  );

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(extension)) {
        chat.reportError(`ORBIT reads ${ACCEPTED_EXTENSIONS.join(', ')} files. Save spreadsheets as CSV first.`);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        chat.reportError(`"${file.name}" is larger than ${MAX_FILE_BYTES / 1024} KB.`);
        return;
      }
      setAttachment({ filename: file.name, content: await file.text(), size: file.size });
      wrapperRef.current?.querySelector('textarea')?.focus();
    },
    [chat]
  );

  return (
    <div ref={wrapperRef}>
      <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS.join(',')} onChange={handleFile} className="hidden" />
      <HarveyChatInput
        value={value}
        onChange={setValue}
        onSend={handleSend}
        disabled={disabled}
        busy={chat.isSending}
        showHint={false}
        allowEmpty={attachment !== null}
        placeholder={
          attachment
            ? 'Say what to do with the file (optional)...'
            : chat.isSending
              ? chat.activity
                ? 'ORBIT is answering. You can type your next message...'
                : 'ORBIT is answering in another conversation...'
              : placeholder
        }
        disabledPlaceholder={chat.availability === 'unavailable' ? 'ORBIT is not available right now' : 'Connecting to ORBIT...'}
        header={
          attachment && (
            <div className="mb-2 flex items-center gap-2 animate-slide-up">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-tp-hairline bg-tp-surface px-2 py-1 text-[12px] text-tp-ink">
                <MdInsertDriveFile size={14} className="shrink-0 text-tp-primary" />
                <span className="truncate">{attachment.filename}</span>
                <span className="shrink-0 text-tp-stone">· {Math.max(1, Math.round(attachment.size / 1024))} KB</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="Remove file"
                  className="cursor-pointer rounded p-0.5 text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink"
                >
                  <MdClose size={13} />
                </button>
              </span>
            </div>
          )
        }
        leading={
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || chat.isSending}
            aria-label="Attach a CSV, TSV, text or pricing YAML file"
            title="Attach a CSV, TSV, text or pricing YAML file"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MdAttachFile size={18} />
          </button>
        }
      />
    </div>
  );
});

export default OrbitComposer;
