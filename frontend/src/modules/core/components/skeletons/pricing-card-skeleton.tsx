import Skeleton from 'react-loading-skeleton';

export default function PricingCardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      {/* Breadcrumb + header */}
      <div className="mb-6">
        <Skeleton width={200} height={12} />
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Skeleton width={280} height={32} />
            <Skeleton width={160} height={14} className="mt-2" />
          </div>
          <Skeleton width={100} height={32} />
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
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} width={100} height={40} />
        ))}
      </div>

      {/* Content: 2-column */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton height={400} />
        <div className="space-y-4">
          <Skeleton height={200} />
          <Skeleton height={160} />
        </div>
      </div>
    </div>
  );
}
