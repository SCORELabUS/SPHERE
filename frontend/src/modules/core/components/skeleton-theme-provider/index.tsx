import { SkeletonTheme } from 'react-loading-skeleton';
import { type ReactNode } from 'react';
import { useMode } from '../../hooks/useTheme';

export default function SkeletonThemeProvider({ children }: { children: ReactNode }) {
  const { mode } = useMode();
  const isDark = mode === 'dark';

  return (
    <SkeletonTheme
      baseColor={isDark ? '#222222' : '#ededed'}
      highlightColor={isDark ? '#1a1a1a' : '#fafafa'}
      borderRadius={12}
    >
      {children}
    </SkeletonTheme>
  );
}
