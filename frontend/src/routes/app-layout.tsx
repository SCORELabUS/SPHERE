import { useAuth } from '../modules/auth/hooks/useAuth';
import PublicLayout from '../modules/presentation/layouts/public-layout';
import AuthenticatedLayout from '../modules/presentation/layouts/authenticated-layout';
import LoadingView from '../modules/core/pages/loading';

interface Props {
  children: React.ReactNode;
}

export default function AppLayout({ children }: Props) {
  const { authUser } = useAuth();

  if (authUser.isLoading) {
    return <LoadingView />;
  }

  if (authUser.isAuthenticated) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
  }

  return <PublicLayout>{children}</PublicLayout>;
}
