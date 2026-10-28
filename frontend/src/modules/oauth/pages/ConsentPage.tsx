import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/hooks/useAuth';
import OrganizationSearchInput, { type OrgSearchResult } from '../../core/components/organization-search-input';
import ScopeSelector from '../../core/components/scope-selector';
import type { ApiKeyScope } from '../../api-keys/api/apiKeysApi';
import { oauthApi } from '../api/oauthApi';
import { rememberConsent } from '../utils/consentReturn';

export default function ConsentPage() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const request = params.get('request') || '';
  const [client, setClient] = useState<{ clientName: string; redirectDomain: string } | null>(null);
  const [organizations, setOrganizations] = useState<OrgSearchResult[]>([]);
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const token = authUser.token;

  useEffect(() => {
    if (authUser.isLoading) return;
    if (!/^[a-f0-9]{64}$/.test(request)) { setError('This connection request is invalid. Start again from your assistant.'); return; }
    if (!authUser.isAuthenticated || !token) {
      rememberConsent(request);
      navigate('/authentication', { replace: true });
      return;
    }
    let active = true;
    oauthApi<{ clientName: string; redirectDomain: string }>(`/requests/${request}`, token)
      .then(value => { if (active) setClient(value); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [request, token, authUser.isAuthenticated, authUser.isLoading, navigate]);

  function chooseOrganizations(next: OrgSearchResult[]) {
    setOrganizations(next);
    setScopes(next.map(org => scopes.find(scope => scope.organizationId === org.id) || { organizationId: org.id, scope: 'VIEW' }));
  }

  async function decide(approve: boolean) {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await oauthApi<{ redirectUrl: string }>(`/requests/${request}`, token, 'POST', { approve, scopes });
      window.location.assign(result.redirectUrl);
    } catch (err) { setError(err instanceof Error ? err.message : 'Connection failed'); setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-20">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-tp-primary">SPHERE / Connected applications</p>
      <h1 className="font-display text-4xl tracking-tight text-tp-ink">Connect your assistant</h1>
      <p className="mt-3 text-sm leading-relaxed text-tp-steel">Choose what this application can access through ORBIT. Your SPHERE permissions still apply to every action.</p>
      {error && <p role="alert" className="my-5 rounded-lg border border-tp-hairline bg-tp-surface p-4 text-sm text-tp-ink">{error}</p>}
      {client ? (
        <section aria-label="Application access" className="mt-8 rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-1">
          <p className="text-xs text-tp-steel">Application requesting access</p>
          <h2 className="mt-1 break-words text-xl font-semibold text-tp-ink">{client.clientName}</h2>
          <p className="mt-3 break-words text-sm text-tp-slate">You will return to <strong>{client.redirectDomain}</strong></p>
          <p className="mt-2 text-xs text-tp-steel">Check this domain before approving. Application names are provided by the application.</p>
          <div className="mt-7 space-y-4">
            <h3 className="text-sm font-semibold text-tp-ink">Organizations and access</h3>
            <OrganizationSearchInput selectedOrgs={organizations} onOrgsChange={chooseOrganizations} />
            <ScopeSelector organizations={organizations} selectedScopes={scopes} onChange={setScopes} />
          </div>
          <p className="mt-6 text-xs leading-relaxed text-tp-steel">Access continues until you revoke it or the connection expires. You can revoke it from Settings → Connected applications.</p>
          <div className="mt-6 flex justify-end gap-3">
            <button disabled={busy} onClick={() => decide(false)} className="cursor-pointer rounded-lg border border-tp-hairline px-5 py-2.5 text-sm text-tp-ink disabled:opacity-50">Deny</button>
            <button disabled={busy || !scopes.length} onClick={() => decide(true)} className="cursor-pointer rounded-lg bg-tp-primary px-5 py-2.5 text-sm font-medium text-tp-on-primary disabled:opacity-50">{busy ? 'Connecting…' : 'Allow access'}</button>
          </div>
        </section>
      ) : !error ? <p className="mt-8 text-sm text-tp-steel" role="status">Loading connection request…</p> : null}
      <Link to="/" className="mt-6 inline-block cursor-pointer text-sm text-tp-steel underline">Back to SPHERE</Link>
    </main>
  );
}
