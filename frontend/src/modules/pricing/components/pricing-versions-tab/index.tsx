import { formatDistanceToNow, parseISO } from 'date-fns';
import type { VersionData } from '../../types/card';

interface PricingVersionsTabProps {
  versions: VersionData[];
  currentVersion: VersionData | null;
  canDelete: boolean;
  onDownload: (v: VersionData) => void;
  onOpenInEditor: (v: VersionData) => void;
  onCopyLink: (v: VersionData) => void;
  onDelete: (v: VersionData) => void;
}

export default function PricingVersionsTab({
  versions,
  currentVersion,
  canDelete,
  onDownload,
  onOpenInEditor,
  onCopyLink,
  onDelete,
}: PricingVersionsTabProps) {
  return (
    <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas">
      <div className="divide-y divide-tp-hairline-soft">
        {versions.map(v => (
          <div key={v.id} className={`flex flex-col gap-3 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${v.id === currentVersion?.id ? 'bg-tp-primary/5' : ''}`}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-tp-ink">{v.version}</span>
              {v.id === currentVersion?.id && <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[10px] font-medium text-tp-primary">Current</span>}
              {v.private && <span className="rounded-full bg-tp-surface px-2 py-0.5 text-[10px] font-medium text-tp-steel">Private</span>}
              <span className="text-[11px] text-tp-steel">{formatDistanceToNow(parseISO(v.createdAt))} ago</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onDownload(v)} title="Download YAML" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></button>
              <button type="button" onClick={() => onOpenInEditor(v)} title="Open in editor" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg></button>
              <button type="button" onClick={() => onCopyLink(v)} title="Copy link" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg></button>
              {canDelete && <button type="button" onClick={() => onDelete(v)} title="Delete version" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-red-50 hover:text-red-500"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg></button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
