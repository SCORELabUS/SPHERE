import { motion } from 'framer-motion';

interface Props {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const getPages = () => {
    const pages: (number | '...')[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    pages.push(1);

    let rangeStart = Math.max(2, currentPage - 1);
    let rangeEnd = Math.min(totalPages - 1, currentPage + 1);

    if (currentPage <= 3) {
      rangeEnd = Math.max(rangeEnd, 3);
    }
    if (currentPage >= totalPages - 2) {
      rangeStart = Math.min(rangeStart, totalPages - 2);
    }

    if (rangeStart > 2) pages.push('...');
    for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
    if (rangeEnd < totalPages - 1) pages.push('...');

    pages.push(totalPages);

    return pages;
  };

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="flex h-8 cursor-pointer items-center justify-center rounded-md px-2 text-sm text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-default disabled:opacity-30"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>

      {getPages().map((page, i) =>
        page === '...' ? (
          <span key={`dots-${i}`} className="px-1 text-xs text-tp-muted">
            …
          </span>
        ) : (
          <motion.button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            whileTap={{ scale: 0.95 }}
            className={`flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-sm transition-colors ${
              page === currentPage
                ? 'bg-tp-ink font-medium text-tp-on-dark'
                : 'text-tp-steel hover:bg-tp-surface hover:text-tp-ink'
            }`}
          >
            {page}
          </motion.button>
        )
      )}

      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="flex h-8 cursor-pointer items-center justify-center rounded-md px-2 text-sm text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-default disabled:opacity-30"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </nav>
  );
}
