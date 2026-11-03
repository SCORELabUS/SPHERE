import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/hooks/useAuth';
import { rememberConsent } from '../utils/consentReturn';

export default function IdentityConsentPage() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const request = params.get('request') || '';
  const [client, setClient] = useState<{ redirectDomain: string; scopes: string[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const token = authUser.token;
  async function api(method = 'GET', approve?: boolean) {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/oidc/requests/${request}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ approve }) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error_description || result.error || 'Unable to sign in');
    return result;
  }
  useEffect(() => {
    if (authUser.isLoading) return;
    if (!/^[a-f0-9]{64}$/.test(request)) { setError('Invalid sign-in request. Start again from SPACE.'); return; }
    if (!authUser.isAuthenticated || !token) {
      rememberConsent(request, 'oidc');
      navigate('/authentication', { replace: true });
      return;
    }
    let active = true;
    api().then(value => { if (active) setClient(value); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  // The request and authenticated session fully identify this consent read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, token, authUser.isAuthenticated, authUser.isLoading, navigate]);
  async function decide(approve: boolean) {
    if (busy) return;
    setBusy(true);
    try { const result = await api('POST', approve); window.location.assign(result.redirectUrl); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in'); setBusy(false); }
  }
  return <div className="mx-auto w-full max-w-[36rem] px-5 py-12 sm:py-20">
    <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-tp-primary">SPHERE / Sign in</p>
    <h1 className="font-display text-4xl tracking-tight text-tp-ink">Continue to SPACE</h1>
    <p className="mt-3 text-sm leading-relaxed text-tp-steel">Use your SPHERE account to sign in to SPACE.</p>
    {error && <p role="alert" className="my-5 rounded-lg border border-tp-hairline bg-tp-surface p-4 text-sm text-tp-ink">{error}</p>}
    {client ? <section aria-label="Identity access" className="mt-8 rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-1">
      <h2 className="text-lg font-semibold text-tp-ink">Share your identity with SPACE</h2>
      <p className="mt-3 text-sm text-tp-slate">Signed in as <strong>{authUser.user?.username}</strong>. SPACE will receive your account identifier{client.scopes.includes('profile') ? ', username and name' : ''}{client.scopes.includes('email') ? ', and email with its verification status' : ''}.</p>
      <p className="mt-3 text-sm text-tp-steel">Your SPACE username is chosen in SPACE and stays independent of your SPHERE username.</p>
      <p className="mt-4 break-words text-sm text-tp-ink">Return to <strong>{client.redirectDomain}</strong></p>
      <div className="mt-6 flex justify-end gap-3">
        <button disabled={busy} onClick={() => decide(false)} className="cursor-pointer rounded-lg border border-tp-hairline px-5 py-2.5 text-sm text-tp-ink focus-visible:outline-2 focus-visible:outline-tp-primary disabled:opacity-50">Cancel</button>
        <button disabled={busy} onClick={() => decide(true)} className="cursor-pointer rounded-lg bg-tp-primary px-5 py-2.5 text-sm font-medium text-tp-on-primary focus-visible:outline-2 focus-visible:outline-tp-primary disabled:opacity-50">{busy ? 'Continuing…' : 'Continue to SPACE'}</button>
      </div>
    </section> : !error ? <p role="status" className="mt-8 text-sm text-tp-steel">Loading sign-in request…</p> : null}
    <Link to="/" className="mt-6 inline-block cursor-pointer text-sm text-tp-steel underline">Back to SPHERE</Link>
  </div>;
}
