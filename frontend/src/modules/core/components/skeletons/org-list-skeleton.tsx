import Skeleton from 'react-loading-skeleton';

export default function OrgListSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Skeleton width={240} height={36} />
            <Skeleton width={180} height={14} className="mt-2" />
          </div>
          <Skeleton width={160} height={40} />
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <Skeleton height={44} />
      </div>

      {/* Org rows */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-tp-hairline bg-tp-canvas p-5 dark:border-tp-hairline dark:bg-tp-surface"
          >
            <Skeleton width={52} height={52} />
            <div className="flex-1 space-y-2">
              <Skeleton width={160} height={16} />
              <Skeleton width={100} height={12} />
            </div>
            <Skeleton width={56} height={24} borderRadius={9999} />
          </div>
        ))}
      </div>
    </div>
  );
}
