import { useAuthConfig } from '../contexts/authConfig';
import { identitySession, jwtExpiration, isIdentityToken } from '../api/identityApi';
import { useCallback, useContext, useEffect, useRef } from 'react';
import { useLocalStorage } from '../../core/hooks/useLocalStorage';
import { AuthContext } from '../contexts/authContext';
import { getCurrentUser, USERS_BASE_PATH } from '../api/usersApi';

const AUTH_TOKEN_KEY = 'token';
const AUTH_USER_KEY = 'auth_user';
let authBootstrapPromise: Promise<void> | null = null;
let identityGeneration = 0;
let identityRefreshPromise: Promise<void> | null = null;

const API_URL = import.meta.env.VITE_API_URL;

export interface AuthUserContext {
  user: AuthUser | null;
  isAuthenticated: boolean;
  token: string | null;
  tokenExpiration: Date | null;
  isLoading: boolean;
}

export interface AuthUserSettings {
  phone?: string;
  avatar?: string;
  avatarBgColor?: string;
  avatarFgColor?: string;
  profile?: {
    displayName?: string;
    bio?: string;
    city?: string;
    country?: string;
    dateOfBirth?: string;
  };
  socialLinks?: {
    linkedin?: string;
    instagram?: string;
    facebook?: string;
    x?: string;
  };
  notificationPrefs?: Record<string, { email: boolean; inbox: boolean }>;
  betaFeatures?: boolean;
}

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
  settings?: AuthUserSettings;
}

const normalizeUser = (user: any): AuthUser => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  username: user.username,
  email: user.email,
  avatar: user.settings?.avatar || user.avatar || '',
  role: user.role || 'USER',
  settings: user.settings,
});

async function fetchUserSettings(token: string): Promise<AuthUserSettings | undefined> {
  try {
    const res = await fetch(`${API_URL}/users/me/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.settings;
  } catch {
    return undefined;
  }
}

export const useAuth = () => {
  const { authUser, setAuthUser } = useContext(AuthContext);
  const identity = useAuthConfig().provider === 'scoretech';
  const { getItem, setItem, removeItem } = useLocalStorage();
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const setSession = useCallback((user: AuthUser, token: string, tokenExpiration: Date | null = null) => {
    setAuthUser({
      user,
      isAuthenticated: true,
      token,
      tokenExpiration,
      isLoading: false,
    });

    setItem(AUTH_TOKEN_KEY, token);
    setItem(AUTH_USER_KEY, JSON.stringify(user));
  }, [setAuthUser, setItem]);

  const clearSession = useCallback(() => {
    identityGeneration++;
    setAuthUser({
      user: null,
      isAuthenticated: false,
      token: null,
      tokenExpiration: null,
      isLoading: false,
    });

    removeItem(AUTH_TOKEN_KEY);
    removeItem(AUTH_USER_KEY);
  }, [setAuthUser, removeItem]);

  const refreshTokenIfNeeded = useCallback(async (force = false) => {
    if (identity) {
      if (!authUser.isAuthenticated) return;
      const expiration = authUser.token ? jwtExpiration(authUser.token)?.getTime() || 0 : 0;
      if (!force && expiration > Date.now() + 60000) return;
      const generation = identityGeneration;
      if (!identityRefreshPromise) identityRefreshPromise = (async () => {
        try {
          const result = await identitySession();
          const current = normalizeUser(await getCurrentUser(result.token));
          if (authUser.user && current.id !== authUser.user.id) throw Object.assign(new Error('Your active account changed. Sign in again.'), { status: 401 });
          const settings = await fetchUserSettings(result.token); if (settings) current.settings = settings;
          if (generation === identityGeneration) setSession(current, result.token, new Date(result.tokenExpiration));
        } catch (error) {
          if ((error as { status?: number }).status === 401) clearSession();
          throw error;
        }
      })().finally(() => { identityRefreshPromise = null; });
      return identityRefreshPromise;
    }

    if (!authUser.token || !authUser.user?.username || !authUser.tokenExpiration) {
      return;
    }

    const expirationTime = new Date(authUser.tokenExpiration).getTime();
    const currentTime = Date.now();
    const timeDifference = expirationTime - currentTime;

    if (timeDifference > 60 * 60 * 1000 || timeDifference <= 0) {
      return;
    }

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const refreshPromise = fetch(`${USERS_BASE_PATH}/${authUser.user.username}/refresh-token`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${authUser.token}`,
      },
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.token) {
          throw new Error(body.error || 'Failed to refresh token');
        }

        const tokenExpiration = body.tokenExpiration ? new Date(body.tokenExpiration) : authUser.tokenExpiration;
        setSession(authUser.user!, body.token, tokenExpiration);
      })
      .catch(() => {
        clearSession();
      })
      .finally(() => {
        refreshInFlightRef.current = null;
      });

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [identity, authUser.isAuthenticated, authUser.token, authUser.user, authUser.tokenExpiration, setSession, clearSession]);

  useEffect(() => {
    if (!authUser.isLoading) {
      return;
    }

    if (authBootstrapPromise) {
      return;
    }

    const bootstrapSession = async () => {
      const storedToken = getItem(AUTH_TOKEN_KEY);
      const storedUser = getItem(AUTH_USER_KEY);

      if (identity) {
        if (window.location.pathname === '/sso/identity/callback') sessionStorage.removeItem('sphere_identity_signed_out');
        if (sessionStorage.getItem('sphere_identity_signed_out')) { clearSession(); return; }
        try {
          const result = await identitySession(); const user = normalizeUser(await getCurrentUser(result.token));
          const settings = await fetchUserSettings(result.token); if (settings) user.settings = settings;
          setSession(user, result.token, new Date(result.tokenExpiration));
        } catch (error) {
          if ((error as { status?: number }).status !== 401 && storedUser && storedToken && isIdentityToken(storedToken)) {
            try { setSession(normalizeUser(JSON.parse(storedUser)), storedToken, jwtExpiration(storedToken)); return; } catch { /* Invalid local cache. */ }
          }
          clearSession();
        }
        return;
      }
      if (storedToken) {
        try { if (JSON.parse(atob(storedToken.split('.')[1])).identitySessionId) { clearSession(); return; } } catch { /* The API validates the token. */ }
      }
      if (!storedToken) {
        clearSession();
        return;
      }

      try {
        const currentUser = await getCurrentUser(storedToken);
        const user = normalizeUser(currentUser);
        const settings = await fetchUserSettings(storedToken);
        if (settings) user.settings = settings;
        setSession(user, storedToken, null);
      } catch {
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser);
            setSession(normalizeUser(parsedUser), storedToken, null);
            return;
          } catch {
            clearSession();
            return;
          }
        }
        clearSession();
      }
    };

    authBootstrapPromise = bootstrapSession().finally(() => {
      authBootstrapPromise = null;
    });
  }, [authUser.isLoading]);

  const login = useCallback(async (token: string) => {
    const currentUser = await getCurrentUser(token);
    const user = normalizeUser(currentUser);
    const settings = await fetchUserSettings(token);
    if (settings) user.settings = settings;
    setSession(user, token, identity ? jwtExpiration(token) : null);
  }, [identity, setSession]);

  const logout = useCallback(() => {
    if (identity) sessionStorage.setItem('sphere_identity_signed_out', '1');
    clearSession();
    if (identity) void fetch(`${API_URL}/auth/identity/logout`, { method: 'POST', credentials: 'include', cache: 'no-store' }).catch(() => {});
  }, [identity, clearSession]);
  useEffect(() => {
    if (!identity || !authUser.isAuthenticated) return;
    const resume = () => { if (document.visibilityState === 'visible') void refreshTokenIfNeeded().catch(() => {}); };
    const interval = window.setInterval(resume, 30000);
    window.addEventListener('focus', resume); window.addEventListener('pageshow', resume); document.addEventListener('visibilitychange', resume);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume); document.removeEventListener('visibilitychange', resume); };
  }, [identity, authUser.isAuthenticated, refreshTokenIfNeeded]);

  const updateUser = useCallback((partial: Partial<AuthUser>) => {
    setAuthUser((prev) => {
      if (!prev.user) return prev;
      return {
        ...prev,
        user: { ...prev.user, ...partial },
      };
    });
  }, [setAuthUser]);

  const updateUserSettings = useCallback((partial: Partial<AuthUserSettings>) => {
    setAuthUser((prev) => {
      if (!prev.user) return prev;
      return {
        ...prev,
        user: {
          ...prev.user,
          settings: { ...prev.user.settings, ...partial },
          avatar: partial.avatar !== undefined ? partial.avatar : prev.user.avatar,
        },
      };
    });
  }, [setAuthUser]);

  const fetchWithInterceptor = useCallback(async (url: RequestInfo | URL, options?: RequestInit) => {
    await refreshTokenIfNeeded();

    const currentToken = getItem(AUTH_TOKEN_KEY) ?? authUser.token;
    const baseHeaders = options?.headers ? new Headers(options.headers) : new Headers();

    if (currentToken && !baseHeaders.has('Authorization')) {
      baseHeaders.set('Authorization', `Bearer ${currentToken}`);
    }

    let response = await fetch(url, {
      ...options,
      headers: baseHeaders,
    });

    if (response.status === 401 && identity) {
      await refreshTokenIfNeeded(true);
      const refreshed = getItem(AUTH_TOKEN_KEY);
      if (refreshed && refreshed !== currentToken) {
        baseHeaders.set('Authorization', `Bearer ${refreshed}`);
        response = await fetch(url, { ...options, headers: baseHeaders });
      }
    }
    if (response.status === 401) clearSession();

    return response;
  }, [identity, authUser.token, clearSession, getItem, refreshTokenIfNeeded]);

  return { authUser, login, logout, setAuthUser, updateUser, updateUserSettings, fetchWithInterceptor };
};
