import AppHeader from './app-header';
import AppFooter from './app-footer';
import SunsetStripeBand from '../../../core/components/sunset-stripe';

export default function AuthenticatedLayout({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-tp-surface">
      <AppHeader />

      <main className="flex-1">
        {children}
      </main>

      <SunsetStripeBand />
      <AppFooter />
    </div>
  );
}
