import { AlertCircle, RefreshCw } from 'lucide-react';

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 h-[116px]">
            <div className="h-3.5 w-28 bg-slate-800 rounded mb-4" />
            <div className="h-7 w-20 bg-slate-800 rounded mb-3" />
            <div className="h-3 w-36 bg-slate-800/70 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-[#111827] border border-slate-800/90 rounded-lg p-5 h-[320px]" />
        <div className="lg:col-span-5 bg-[#111827] border border-slate-800/90 rounded-lg p-5 h-[320px]" />
      </div>
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 h-[280px]" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-800/80 animate-pulse" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-3 px-4 gap-4">
          <div className="space-y-1.5 flex-1">
            <div className="h-3.5 w-2/5 bg-slate-800 rounded" />
            <div className="h-3 w-1/4 bg-slate-800/70 rounded" />
          </div>
          <div className="h-3.5 w-16 bg-slate-800 rounded" />
          <div className="h-3.5 w-12 bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-lg py-12 px-6 text-center">
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-400 max-w-md mx-auto">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center justify-center px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-[#161B26] border border-red-500/40 rounded-lg px-4 py-3 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-2.5 text-sm text-red-300">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}
