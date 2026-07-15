import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRouter } from '../../../core/hooks/useRouter';
import { exchangeSsoCode } from '../../api/usersApi';

// Error keys emitted by the backend SSOController in ?sso_error=
const ERROR_MESSAGES: Record<string, string> = {
  invalid_response: 'Validation with the identity provider failed.',
  unknown_provider: 'Unknown identity provider.',
  invalid_state: 'The authentication session expired or is invalid. Please try again.',
  server_error: 'There was an error processing your sign in.',
};

export default function SsoCallbackPage() {
  const [params] = useSearchParams();
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const ssoError = params.get('sso_error');
    if (ssoError) {
      setError(ERROR_MESSAGES[ssoError] ?? 'Authentication error.');
      return;
    }

    const code = params.get('code');
    if (!code) {
      setError('Missing authentication code.');
      return;
    }

    exchangeSsoCode(code)
      .then(async ({ token }) => {
        // The code is single-use; drop it from the URL/history before navigating.
        window.history.replaceState({}, '', '/sso/callback');
        await login(token);
        router.push('/');
      })
      .catch((e: Error) => setError(e.message));
  }, [params, login, router]);

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/50">
          <p className="text-sm text-red-600 dark:text-red-400">
            {error}{' '}
            <Link to="/authentication" className="font-medium underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-sm text-tp-steel">Signing you in…</p>
    </div>
  );
}
