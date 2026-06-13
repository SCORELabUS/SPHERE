import Skeleton from 'react-loading-skeleton';

export default function OrgDetailSkeleton() {
  return (
    <div className="min-h-screen">
      {/* Hero header */}
      <div className="border-b border-tp-hairline bg-gradient-to-br from-tp-cream via-tp-cream-light to-tp-canvas">
        <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-10">
          {/* Back link */}
          <Skeleton width={120} height={14} className="mb-5" />

          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {/* Avatar */}
            <Skeleton width={80} height={80} className="shrink-0" />

            {/* Info */}
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <Skeleton width={240} height={32} />
                <Skeleton width={60} height={22} />
                <Skeleton width={60} height={32} />
              </div>
              <Skeleton width={140} height={14} className="mt-1" />
              <Skeleton width={300} height={14} className="mt-2" />
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width={100} height={16} />
            ))}
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="border-b border-tp-hairline bg-tp-canvas/80 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 md:px-8">
          <div className="flex gap-1 py-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width={100} height={36} />
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-tp-hairline bg-tp-canvas p-4">
              <div className="flex items-center gap-3">
                <Skeleton width={36} height={36} />
                <div>
                  <Skeleton width={80} height={24} />
                  <Skeleton width={60} height={10} className="mt-1" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
