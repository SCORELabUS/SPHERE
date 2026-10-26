import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { MdUploadFile } from 'react-icons/md';

interface Props {
  onFile: (file: File) => void;
  /** Several files at once: only one goes with a message. */
  onTooMany: () => void;
  disabled?: boolean;
  compact?: boolean;
  children: ReactNode;
}

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/** The conversation and its message box, where a file from the computer can be dropped to attach it. */
export default function OrbitDropZone({ onFile, onTooMany, disabled = false, compact = false, children }: Props) {
  const [dragging, setDragging] = useState(false);
  // Entering a child fires dragleave on its parent, so the overlay follows a count.
  const depthRef = useRef(0);

  const onDragEnter = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depthRef.current++;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    // Without this the browser opens the file instead of handing it over.
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  };
  const onDragLeave = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depthRef.current = 0;
    setDragging(false);
    if (disabled) return;
    const files = event.dataTransfer.files;
    if (files.length > 1) onTooMany();
    else if (files.length === 1) onFile(files[0]);
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {children}
      {dragging && (
        <div
          className={`pointer-events-none absolute z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-tp-canvas/90 text-center backdrop-blur-[2px] animate-fade-in ${
            compact ? 'inset-2' : 'inset-3'
          } ${disabled ? 'border-tp-hairline' : 'border-tp-primary'}`}
        >
          <MdUploadFile size={compact ? 30 : 38} className={disabled ? 'text-tp-stone' : 'text-tp-primary'} />
          <p className="text-sm font-medium text-tp-ink">
            {disabled ? 'ORBIT cannot take a file right now' : 'Drop the file to attach it'}
          </p>
          {!disabled && <p className="px-4 text-[12px] text-tp-steel">CSV, TSV, text or pricing YAML, up to 512 KB</p>}
        </div>
      )}
    </div>
  );
}
