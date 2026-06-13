import Skeleton from 'react-loading-skeleton';

export default function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
      {/* Welcome header */}
      <div className="mb-8">
        <Skeleton width={320} height={36} />
        <Skeleton width={240} height={16} className="mt-2" />
      </div>

      {/* Stats grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-tp-hairline bg-tp-canvas p-4">
            <Skeleton width={40} height={40} />
            <div>
              <Skeleton width={48} height={28} />
              <Skeleton width={64} height={12} className="mt-1" />
            </div>
          </div>
        ))}
      </div>

      {/* 2-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Organizations section */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Skeleton width={120} height={16} />
              <Skeleton width={48} height={12} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-tp-hairline bg-tp-canvas p-4">
                  <Skeleton width={36} height={36} />
                  <div className="flex-1">
                    <Skeleton width="70%" height={14} />
                    <Skeleton width="40%" height={10} className="mt-1" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Pricings section */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Skeleton width={120} height={16} />
              <Skeleton width={48} height={12} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} height={128} />
              ))}
            </div>
          </div>

          {/* Recent Collections section */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Skeleton width={140} height={16} />
              <Skeleton width={48} height={12} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} height={128} />
              ))}
            </div>
          </div>
        </div>

        {/* Right column — Quick Actions */}
        <div className="space-y-3">
          <Skeleton width={100} height={16} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-tp-hairline bg-tp-canvas p-4">
              <Skeleton width={36} height={36} />
              <div className="flex-1">
                <Skeleton width="60%" height={14} />
                <Skeleton width="80%" height={10} className="mt-1" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
