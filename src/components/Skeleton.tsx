/**
 * Skeleton / shimmer loading placeholders for tab transitions and deferred rendering.
 * Matches the dark theme — animates a subtle highlight sweep across placeholder shapes.
 */

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

/** Generic skeleton block with shimmer animation */
export function SkeletonBlock({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer rounded ${className}`}
      style={style}
    />
  );
}

/** Skeleton for chart-heavy views (Pareto, BOILED-Egg, Radar, etc.) */
export function ChartSkeleton() {
  return (
    <div className="animate-fade-in space-y-4">
      {/* Controls bar */}
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-8 w-24" />
        <SkeletonBlock className="h-8 w-32" />
        <SkeletonBlock className="h-8 w-20" />
      </div>
      {/* Chart area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SkeletonBlock className="h-[320px] w-full" />
        <SkeletonBlock className="h-[320px] w-full" />
      </div>
      {/* Second row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SkeletonBlock className="h-[320px] w-full" />
        <SkeletonBlock className="h-[320px] w-full" />
      </div>
    </div>
  );
}

/** Skeleton for table views */
export function TableSkeleton() {
  return (
    <div className="animate-fade-in space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-8 flex-1" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: 8 }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: 7 }).map((_, c) => (
            <SkeletonBlock key={c} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton for single large canvas (similarity matrix, chem space) */
export function CanvasSkeleton() {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-8 w-28" />
        <SkeletonBlock className="h-8 w-36" />
      </div>
      <SkeletonBlock className="h-[480px] w-full" />
    </div>
  );
}

/** Skeleton for card-grid views (scaffolds, compare, activity cliffs) */
export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <SkeletonBlock className="h-8 w-32" />
        <SkeletonBlock className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="rounded-lg border border-[var(--border-5)] p-4 space-y-3">
            <SkeletonBlock className="h-[120px] w-full" />
            <SkeletonBlock className="h-4 w-3/4" />
            <SkeletonBlock className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Overlay shimmer for deferred content (fading pulse while React reconciles) */
export function DeferredOverlay({ isStale }: { isStale: boolean }) {
  if (!isStale) return null;
  return (
    <div className="absolute inset-0 bg-[var(--bg)]/60 z-20 flex items-center justify-center backdrop-blur-[1px] rounded-lg transition-opacity duration-200">
      <div className="flex items-center gap-3 text-[var(--text2)] text-[13px]">
        <div className="w-4 h-4 border-2 border-[#5F7367]/30 border-t-[#5F7367] rounded-full animate-spin" />
        <span>Updating view…</span>
      </div>
    </div>
  );
}

