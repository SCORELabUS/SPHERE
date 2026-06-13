import Skeleton from 'react-loading-skeleton';

export default function PricingListSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      {/* Header */}
      <div className="mb-6">
        <Skeleton width={160} height={32} />
        <Skeleton width={360} height={16} className="mt-2" />
      </div>

      {/* Search bar */}
      <div className="mb-5 flex items-center gap-3">
        <Skeleton height={40} className="flex-1" />
        <Skeleton width={80} height={40} />
      </div>

      {/* Results count */}
      <Skeleton width={140} height={12} className="mb-4" />

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} height={128} />
        ))}
      </div>

      {/* Pagination */}
      <div className="mt-6 flex justify-center">
        <Skeleton width={240} height={36} />
      </div>
    </div>
  );
}
