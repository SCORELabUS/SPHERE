interface Props {
  className?: string;
}

/** Small "Beta" label to mark a tab, button or section as unfinished. */
export default function BetaBadge({ className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-tp-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-tp-primary ${className}`}
    >
      Beta
    </span>
  );
}
