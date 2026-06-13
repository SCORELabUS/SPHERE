import Skeleton from 'react-loading-skeleton';

export default function EditorSkeleton() {
  return (
    <div className="grid h-full w-full gap-4 bg-slate-300 lg:grid-cols-2">
      {/* Left: editor placeholder */}
      <div className="relative h-full min-h-0 p-4">
        <div className="h-full rounded-xl border border-tp-hairline bg-tp-canvas">
          {/* Line numbers */}
          <div className="flex gap-4 p-4">
            <div className="space-y-2">
              {Array.from({ length: 20 }).map((_, i) => (
                <Skeleton key={i} width={20} height={14} />
              ))}
            </div>
            <div className="flex-1 space-y-2">
              {Array.from({ length: 20 }).map((_, i) => (
                <Skeleton key={i} height={14} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right: preview placeholder */}
      <div className="box-border flex h-full min-h-0 flex-col overflow-hidden bg-slate-200 py-2">
        <div className="space-y-4 p-4">
          <Skeleton width={200} height={28} />
          <Skeleton height={200} />
          <Skeleton height={160} />
          <Skeleton height={120} />
        </div>
      </div>
    </div>
  );
}
