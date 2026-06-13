export default function IslandButton({
  label,
  onClick,
  outlined = false,
}: {
  label: string;
  onClick: () => void;
  outlined?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex cursor-pointer items-center gap-3 rounded-full border px-6 py-3 text-sm font-medium transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${outlined ? 'border-[#0f172a] bg-transparent text-[#0f172a] hover:bg-[#0f172a]/5' : 'border-black/10 bg-[#0f172a] text-white hover:bg-[#1e293b]'}`}
    >
      <span>{label}</span>
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-[1px] group-hover:translate-x-1 group-hover:scale-105 ${outlined ? 'bg-[#0f172a]/10 text-[#0f172a]' : 'bg-white/15 text-white'}`}
      >
        ↗
      </span>
    </button>
  );
}
