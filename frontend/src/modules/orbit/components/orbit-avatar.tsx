interface Props {
  size?: 'sm' | 'md' | 'lg';
  /** Shows a dot circling the avatar while ORBIT is working. */
  busy?: boolean;
  className?: string;
}

const SIZES = {
  sm: { box: 'h-7 w-7 text-[11px]', dot: 'h-1.5 w-1.5' },
  md: { box: 'h-9 w-9 text-sm', dot: 'h-2 w-2' },
  lg: { box: 'h-14 w-14 text-xl', dot: 'h-2.5 w-2.5' },
};

export default function OrbitAvatar({ size = 'sm', busy = false, className = '' }: Props) {
  const { box, dot } = SIZES[size];
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span className={`flex items-center justify-center rounded-full bg-tp-cream font-bold text-tp-primary ${box}`}>O</span>
      {busy && (
        <span className="pointer-events-none absolute -inset-1 animate-orbit-spin" aria-hidden="true">
          <span className={`absolute left-1/2 top-0 -translate-x-1/2 rounded-full bg-tp-primary shadow-elevation-1 ${dot}`} />
        </span>
      )}
    </span>
  );
}
