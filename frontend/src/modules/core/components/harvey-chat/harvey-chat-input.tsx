import { useRef, useEffect, useCallback, type KeyboardEvent, type ChangeEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  /** Keeps the box editable but holds sending, so the next message can be typed while waiting. */
  busy?: boolean;
  placeholder?: string;
  disabledPlaceholder?: string;
  /** Lets an empty message be sent, for example when a file is attached. */
  allowEmpty?: boolean;
  /** Rendered before the text box, such as an attach button. */
  leading?: ReactNode;
  /** Rendered above the text box, such as the chip of an attached file. */
  header?: ReactNode;
}

const MAX_VISIBLE_LINES = 4;
const LINE_HEIGHT_PX = 20;

export default function HarveyChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  busy = false,
  placeholder = 'Ask about this pricing...',
  disabledPlaceholder = 'Waiting for response...',
  allowEmpty = false,
  leading,
  header,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea (WhatsApp-style)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = 'auto';

    const lineHeight = LINE_HEIGHT_PX;
    const maxHeight = lineHeight * MAX_VISIBLE_LINES;
    const scrollHeight = el.scrollHeight;

    if (scrollHeight <= maxHeight) {
      el.style.height = `${scrollHeight}px`;
      el.style.overflowY = 'hidden';
    } else {
      el.style.height = `${maxHeight}px`;
      el.style.overflowY = 'auto';
    }
  }, [value]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!busy && (value.trim() || allowEmpty)) {
          onSend(value);
        }
      }
    },
    [value, onSend, allowEmpty, busy],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleSendClick = useCallback(() => {
    if (!busy && (value.trim() || allowEmpty)) {
      onSend(value);
    }
  }, [value, onSend, allowEmpty, busy]);

  const hasContent = value.trim().length > 0 || allowEmpty;

  return (
    <div className="border-t border-tp-hairline bg-tp-canvas px-3 py-3">
      {header}
      <div className="flex items-end gap-2 rounded-xl border border-tp-hairline-strong bg-tp-surface px-3 py-2 transition-colors focus-within:border-tp-primary/40">
        {leading}

        {/* Textarea — WhatsApp-style */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? disabledPlaceholder : placeholder}
          rows={1}
          disabled={disabled}
          className="max-h-[80px] min-h-[20px] flex-1 resize-none bg-transparent text-[13px] leading-[20px] text-tp-ink placeholder-tp-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ scrollbarWidth: 'thin' }}
        />

        {/* Send button */}
        <motion.button
          type="button"
          onClick={handleSendClick}
          disabled={!hasContent || disabled || busy}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30"
          animate={
            hasContent
              ? { backgroundColor: 'rgb(250, 82, 15)', scale: 1 }
              : { backgroundColor: 'rgb(237, 237, 237)', scale: 1 }
          }
          whileHover={hasContent ? { scale: 1.05 } : {}}
          whileTap={hasContent ? { scale: 0.92 } : {}}
        >
          <svg
            className={`h-4 w-4 ${hasContent ? 'text-tp-on-primary' : 'text-tp-muted'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
        </motion.button>
      </div>

      <p className="mt-1.5 text-center text-[10px] text-tp-muted">
        Press <kbd className="rounded border border-tp-hairline bg-tp-surface px-1 py-0.5 text-[9px] font-medium text-tp-steel">Enter</kbd> to send · <kbd className="rounded border border-tp-hairline bg-tp-surface px-1 py-0.5 text-[9px] font-medium text-tp-steel">Shift+Enter</kbd> for new line
      </p>
    </div>
  );
}
