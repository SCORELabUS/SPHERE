import SphereThemeProvider from './modules/core/theme/theme';
import Router from './routes/router';
import { AuthContext } from './modules/auth/contexts/authContext';
import { AuthUserContext } from './modules/auth/hooks/useAuth';
import { useState } from 'react';
import { useScrollToTop } from './modules/core/hooks/useScrollToTop';
import OrganizationContext from './modules/organization/contexts/organizationContext';
import { useOrganizationManager } from './modules/organization/hooks/useOrganization';
import { NotificationsProvider } from './modules/notification/contexts/notificationsContext';
import { useNotificationsSSE } from './modules/notification/hooks/useNotificationsSSE';
import { ToastProvider } from './modules/core/contexts/toastContext';
import { useToast } from './modules/core/contexts/useToast';

function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { organizations, isLoading, page, totalPages, setPage, refresh } = useOrganizationManager();

  return (
    <OrganizationContext.Provider
      value={{ organizations, isLoading, page, totalPages, setPage, refresh }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

function NotificationsSSEProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToast();
  useNotificationsSSE(addToast);
  return <>{children}</>;
}

export default function App() {
  useScrollToTop();

  const [authUser, setAuthUser] = useState<AuthUserContext>({
    isAuthenticated: false,
    user: null,
    token: null,
    tokenExpiration: null,
    isLoading: true,
  });

  return (
    <SphereThemeProvider>
      <AuthContext.Provider value={{ authUser, setAuthUser }}>
        <OrganizationProvider>
          <NotificationsProvider>
            <ToastProvider>
              <NotificationsSSEProvider>
                <Router />
              </NotificationsSSEProvider>
            </ToastProvider>
          </NotificationsProvider>
        </OrganizationProvider>
      </AuthContext.Provider>
    </SphereThemeProvider>
  );
}
