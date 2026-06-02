interface PrivateAccessFallbackProps {
  entityLabel?: string;
}

export default function PrivateAccessFallback({ entityLabel = 'pricing' }: PrivateAccessFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline-soft bg-tp-canvas py-20 text-center">
      <svg className="mb-4 h-16 w-16 text-tp-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <rect x="8.5" y="11" width="7" height="6" rx="1" />
        <path d="M10 11V9a2 2 0 0 1 4 0v2" />
      </svg>
      <p className="text-sm font-medium text-tp-ink">This {entityLabel} is private</p>
      <p className="mt-1 text-xs text-tp-steel">You don't have permission to view this {entityLabel}. Please request access from an organization admin.</p>
    </div>
  );
}
