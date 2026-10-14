import OrbitLogo from './orbit-logo';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  /** Puts the satellite of the mark into orbit while ORBIT is working. */
  busy?: boolean;
  className?: string;
}

const SIZES = {
  sm: { box: 'h-7 w-7', logo: 'h-[18px] w-[18px]' },
  md: { box: 'h-9 w-9', logo: 'h-6 w-6' },
  lg: { box: 'h-14 w-14', logo: 'h-9 w-9' },
};

export default function OrbitAvatar({ size = 'sm', busy = false, className = '' }: Props) {
  const { box, logo } = SIZES[size];
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-tp-cream text-tp-primary ${box} ${className}`}>
      <OrbitLogo busy={busy} className={logo} />
    </span>
  );
}
