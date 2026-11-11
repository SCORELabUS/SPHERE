import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { FiExternalLink, FiShield, FiLink } from 'react-icons/fi';
import { useAuthConfig } from '../../auth/contexts/authConfig';
import { useAuth } from '../../auth/hooks/useAuth';
export default function IdentityAccountSection({ linking = false }: { linking?: boolean }) {
  const [parameters] = useSearchParams();
  const config = useAuthConfig();
  const { fetchWithInterceptor } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function connect() {
    setBusy(true);
    setError('');
    try {
      const response = await fetchWithInterceptor(
        import.meta.env.VITE_API_URL + '/auth/identity/link',
        { method: 'POST', credentials: 'include' }
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Unable to start the connection');
      window.location.assign(data.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to connect your account.');
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-medium text-tp-ink">
          {linking ? 'Connect your SCORE account' : 'Your SCORETech account'}
        </h2>
        <p className="mt-1 text-sm text-tp-steel">
          {linking
            ? 'Keep this SPHERE account and its existing organizations and permissions when centralized sign-in is enabled.'
            : 'Manage how you sign in to SPHERE and other SCORE services.'}
        </p>
      </div>
      {linking && parameters.get('identity_linked') === 'scoretech' && (
        <p
          role="status"
          className="rounded-lg border border-tp-hairline bg-tp-surface p-4 text-sm text-tp-ink"
        >
          Your existing SPHERE account is connected to SCORETech Identity. Your organizations and
          permissions have been preserved.
        </p>
      )}
      {linking && parameters.get('identity_error') === 'scoretech_link_failed' && (
        <p role="alert" className="text-sm text-tp-severity-error">
          The connection could not be completed. Your existing SPHERE account is unchanged. Try
          again or contact your administrator.
        </p>
      )}
      <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-6 sm:p-8">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-tp-primary/10 text-tp-primary">
          <FiShield size={22} />
        </div>
        <h3 className="text-xl font-semibold text-tp-ink">SCORETech Identity</h3>
        <p className="mt-3 max-w-[36rem] text-sm leading-relaxed text-tp-steel">
          Manage your sign-in email, passkeys and connected providers in SCORETech Identity.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-tp-severity-error">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {linking && (
            <button
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary disabled:opacity-50"
              disabled={busy}
              onClick={() => void connect()}
            >
              <FiLink />
              {busy ? 'Connecting…' : 'Connect SCORETech Identity'}
            </button>
          )}
          <a
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${linking ? 'border border-tp-hairline-strong text-tp-ink' : 'bg-tp-primary text-tp-on-primary'}`}
            href={config.accountUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open my SCORETech profile
            <FiExternalLink size={16} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  );
}
