import Skeleton from 'react-loading-skeleton';

export default function CollectionsListSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      {/* Header */}
      <div className="mb-6">
        <Skeleton width={200} height={32} />
        <Skeleton width={320} height={16} className="mt-2" />
      </div>

      {/* Search + Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton width={320} height={40} />
        <Skeleton width={160} height={40} />
      </div>

      {/* Results count */}
      <Skeleton width={160} height={12} className="mb-4" />

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} height={112} />
        ))}
      </div>

      {/* Pagination */}
      <div className="mt-6 flex justify-center">
        <Skeleton width={240} height={36} />
      </div>
    </div>
  );
}
