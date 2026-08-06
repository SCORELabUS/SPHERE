import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react';

interface Props {
  question: string;
  isSubmitting: boolean;
  isDisabled: boolean;
  isSubmitDisabled: boolean;
  isInputLocked?: boolean;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onFileDrop: (files: FileList | null) => void;
  onOpenContext?: () => void;
}

export default function ChatInput({ question, isSubmitting, isDisabled, isSubmitDisabled, isInputLocked = false, onQuestionChange, onSubmit, onFileDrop, onOpenContext }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    if (!question) {
      el.style.height = 'auto';
      el.style.overflowY = 'hidden';
      return;
    }
    el.style.height = 'auto';
    const maxH = 160;
    const newH = Math.min(el.scrollHeight, maxH);
    el.style.height = `${newH}px`;
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }, [question]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isInputLocked) return;
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isInputLocked) return;
    onFileDrop(e.dataTransfer.files);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSubmitDisabled && !isSubmitting) {
        onSubmit(e as unknown as FormEvent);
      }
    }
  };

  return (
    <div className="border-t border-tp-hairline bg-tp-canvas px-4 py-3">
      <form
        onSubmit={onSubmit}
        className={`mx-auto max-w-200 rounded-xl border transition-colors ${
          isDragging
            ? 'border-tp-primary bg-tp-primary/5'
            : 'border-tp-hairline-strong bg-tp-canvas'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onQuestionChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isInputLocked ? 'Select a predefined scenario...' : 'Ask about pricing strategies...'}
          rows={1}
          disabled={isDisabled}
          readOnly={isInputLocked}
          aria-readonly={isInputLocked}
          className="w-full resize-none box-border bg-transparent px-4 py-3 text-sm text-tp-ink placeholder-tp-muted focus:outline-none read-only:cursor-default disabled:opacity-50 overflow-hidden"
        />

        <div className="flex items-center justify-between border-t border-tp-hairline px-3 py-2">
          <div className="flex items-center gap-1">
            <label className={`rounded-md p-1.5 text-tp-steel transition-colors ${
              isInputLocked
                ? 'cursor-not-allowed opacity-40'
                : 'cursor-pointer hover:bg-tp-surface hover:text-tp-ink'
            }`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.939A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-8.6 8.6" />
              </svg>
              <input
                type="file"
                accept=".yaml,.yml"
                multiple
                hidden
                disabled={isInputLocked}
                onChange={(e) => onFileDrop(e.target.files)}
              />
            </label>
            {onOpenContext && (
              <button
                type="button"
                onClick={onOpenContext}
                className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink lg:hidden"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitDisabled || isSubmitting}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-1.5 text-xs font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Ask
              </>
            )}
          </button>
        </div>
      </form>

      {isDragging && (
        <div className="mx-auto mt-2 max-w-200 rounded-lg bg-tp-primary/10 px-3 py-2 text-center text-xs text-tp-primary">
          Drop YAML files here to add to context
        </div>
      )}
    </div>
  );
}
