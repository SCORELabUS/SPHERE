export function AddRowTrigger({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="group/addrow relative h-0 w-full cursor-pointer" onClick={onAdd}>
      <div className="absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 items-center justify-center opacity-0 transition-opacity group-hover/addrow:opacity-100">
        <div className="flex w-full items-center">
          <div className="h-px flex-1 bg-orange-300 dark:bg-orange-700" />
          <span className="shrink-0 mx-2 cursor-pointer rounded-full border border-dashed border-orange-300 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-500 shadow-sm dark:border-orange-600 dark:bg-slate-900 dark:text-orange-400">
            {label}
          </span>
          <div className="h-px flex-1 bg-orange-300 dark:bg-orange-700" />
        </div>
      </div>
    </div>
  );
}
