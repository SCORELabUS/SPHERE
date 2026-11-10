import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthConfig } from '../contexts/authConfig';
import { consumeConsentReturn } from '../../oauth/utils/consentReturn';
import { useAuth } from '../hooks/useAuth';
export function IdentityRedirect({ register = false }: { register?: boolean }) {
  const config = useAuthConfig();
  const location = useLocation();
  const [params] = useSearchParams();
  const error = params.get('identity_error');
  const from = (
    location.state as { from?: { pathname: string; search?: string; hash?: string } } | null
  )?.from;
  const target = from ? from.pathname + (from.search || '') + (from.hash || '') : '/';
  const url = new URL(register ? config.registerUrl : config.loginUrl, window.location.origin);
  url.searchParams.set('returnTo', target);
  useEffect(() => {
    if (!error) window.location.replace(url.href);
  }, [url.href, error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[36rem] flex-col justify-center gap-5 p-8">
      <h1 className="font-display text-3xl text-tp-ink">
        {error ? 'Sign-in could not be completed' : 'Opening SCORETech Identity…'}
      </h1>
      <p className="text-sm leading-relaxed text-tp-steel">
        {error === 'account_not_linked'
          ? 'A SPHERE account already uses this email. Connect it to SCORETech Identity before switching sign-in providers. Ask your administrator to help you keep your existing account and data.'
          : error
            ? 'Your sign-in request expired or was cancelled. You can safely try again.'
            : 'Use your shared SCORE account to continue.'}
      </p>
      <a
        className="cursor-pointer self-start rounded-lg bg-tp-primary px-5 py-3 text-sm font-medium text-tp-on-primary"
        href={url.href}
      >
        {error ? 'Try again' : 'Continue to SCORETech Identity'}
      </a>
    </main>
  );
}
export function IdentityCallback() {
  const { authUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const destination = useRef<string | null>(null);
  const requested = params.get('returnTo') || '/';
  const safe =
    requested.startsWith('/') && !requested.startsWith('//') && !/[\\\r\n]/.test(requested)
      ? requested
      : '/';
  useEffect(() => {
    if (authUser.isLoading) return;
    if (!authUser.isAuthenticated) {
      navigate('/authentication?identity_error=signin_failed', { replace: true });
      return;
    }
    // Consume one-use consent state only after commit. StrictMode/concurrent
    // rendering may discard a render, and repeated effects must reuse its target.
    destination.current ??= consumeConsentReturn() || safe;
    navigate(destination.current, { replace: true });
  }, [authUser.isLoading, authUser.isAuthenticated, navigate, safe]);
  return <p className="p-8 text-tp-steel">Signing you in…</p>;
}
export function IdentityAwareLocalPage({ children }: { children: React.ReactNode }) {
  return useAuthConfig().provider === 'scoretech' ? <IdentityRedirect /> : <>{children}</>;
}
