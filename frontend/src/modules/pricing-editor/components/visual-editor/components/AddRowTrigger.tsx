import { LABEL_WIDTH } from '../utils/constants';

export function AddRowTrigger({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="group/addrow relative h-0 w-full">
      <button
        type="button"
        onClick={onAdd}
        className="absolute inset-x-0 top-0 z-10 flex h-7 -translate-y-1/2 cursor-pointer items-center opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none group-hover/addrow:opacity-100 [@media(hover:none)]:opacity-100"
        aria-label={label}
        title={label}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-px bg-orange-300 dark:bg-orange-700" />
        <span className="sticky left-0 flex shrink-0 items-center justify-center" style={{ width: LABEL_WIDTH }}>
          <span className="inline-flex size-7 items-center justify-center rounded-full border border-dashed border-orange-300 bg-white text-[11px] font-semibold uppercase tracking-wider text-orange-500 shadow-sm transition-colors group-hover/addrow:border-orange-500 group-hover/addrow:bg-orange-50 sm:h-auto sm:w-auto sm:px-2.5 sm:py-0.5 dark:border-orange-600 dark:bg-slate-900 dark:text-orange-400 dark:group-hover/addrow:bg-orange-950">
            <span aria-hidden="true" className="sm:hidden">+</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
        </span>
      </button>
    </div>
  );
}
