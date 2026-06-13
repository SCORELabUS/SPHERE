import Skeleton from 'react-loading-skeleton';

export default function CollectionCardSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      {/* Header */}
      <div className="mb-6">
        <Skeleton width={180} height={12} />
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Skeleton width={300} height={32} />
            <Skeleton width={200} height={14} className="mt-2" />
          </div>
          <Skeleton width={130} height={36} />
        </div>
      </div>

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-tp-hairline bg-tp-canvas p-3">
            <Skeleton width={80} height={10} />
            <Skeleton width={60} height={24} className="mt-1" />
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b border-tp-hairline">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} width={100} height={40} />
        ))}
      </div>

      {/* Content: pricing grid */}
      <div className="mb-4 flex items-center justify-between">
        <Skeleton width={180} height={16} />
        <Skeleton width={60} height={28} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} height={128} />
        ))}
      </div>
    </div>
  );
}
