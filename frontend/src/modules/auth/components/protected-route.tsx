import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import LoadingView from '../../core/pages/loading';

interface Props {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const { authUser } = useAuth();
  const location = useLocation();

  if (authUser.isLoading) {
    return <LoadingView />;
  }

  if (!authUser.isAuthenticated) {
    return <Navigate to="/authentication" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
