import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export interface AuthConfig {
  provider: 'local' | 'scoretech';
  identityAvailable: boolean;
  loginUrl: string;
  registerUrl: string;
  accountUrl?: string;
}
const defaults: AuthConfig = {
  provider: 'local',
  identityAvailable: false,
  loginUrl: '',
  registerUrl: '',
};
const Context = createContext<AuthConfig>(defaults);
export const useAuthConfig = () => useContext(Context);
export function AuthConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    fetch(import.meta.env.VITE_API_URL + '/auth/config', { cache: 'no-store' })
      .then(async response => {
        // Compatibility with an older API during a staggered deployment.
        if (response.status === 404) return defaults;
        if (!response.ok) throw Error('Authentication configuration unavailable');
        const value: AuthConfig = await response.json();
        if (!['local', 'scoretech'].includes(value.provider))
          throw Error('Invalid authentication configuration');
        return value;
      })
      .then(value => {
        if (active) setConfig(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  if (!config)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-tp-canvas p-8 text-tp-steel">
        <p>{error ? 'Unable to load sign-in settings.' : 'Loading SPHERE…'}</p>
        {error && (
          <button
            className="cursor-pointer text-tp-primary underline"
            onClick={() => setRetry(retry + 1)}
          >
            Try again
          </button>
        )}
      </main>
    );
  return <Context.Provider value={config}>{children}</Context.Provider>;
}
