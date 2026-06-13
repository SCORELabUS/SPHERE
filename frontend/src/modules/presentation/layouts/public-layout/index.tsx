import { useLocation } from 'react-router-dom';
import { useRouter } from '../../../core/hooks/useRouter';
import FloatingMorphHeader from '../../pages/home/components/floating-morph-header';
import FullFooterSection from '../../pages/home/components/full-footer-section';
import SunsetStripeBand from '../../../core/components/sunset-stripe';
import { NAV_ITEMS } from '../../pages/home/data';

export default function PublicLayout({ children }: { children?: React.ReactNode }) {
  const location = useLocation();
  const router = useRouter();
  const isLanding = location.pathname === '/';
  const isAuthPage = location.pathname === '/authentication';

  const handleNavigate = (to: string) => router.push(to);

  if (isLanding || isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-tp-canvas">
      <FloatingMorphHeader navItems={NAV_ITEMS} onNavigate={handleNavigate} />

      <main className="flex-1 pt-24 pb-16">
        {children}
      </main>

      <SunsetStripeBand />
      <FullFooterSection onNavigate={handleNavigate} />
    </div>
  );
}
