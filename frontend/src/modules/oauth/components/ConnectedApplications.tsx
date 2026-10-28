import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { oauthApi, type ConnectedApplication } from '../api/oauthApi';

export default function ConnectedApplications() {
  const { authUser } = useAuth();
  const [applications, setApplications] = useState<ConnectedApplication[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const token = authUser.token;
  useEffect(() => {
    if (!token) return;
    let active = true;
    oauthApi<ConnectedApplication[]>('/grants', token).then(value => { if (active) setApplications(value); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [token]);

  async function revoke(id: string) {
    if (!token) return;
    setBusy(id);
    setError('');
    try {
      await oauthApi(`/grants/${id}`, token, 'DELETE');
      setApplications(current => current?.filter(app => app._id !== id) || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to revoke connection'); }
    finally { setBusy(null); }
  }

  return <section className="space-y-5">
    <div><h2 className="text-xl font-semibold text-tp-ink">Connected applications</h2>
      <p className="mt-2 text-sm text-tp-steel">Assistants with access to ORBIT. Revoking a connection stops its access immediately.</p></div>
    {error && <p role="alert" className="text-sm text-tp-ink">{error}</p>}
    {!applications && !error && <p role="status" className="text-sm text-tp-steel">Loading connections…</p>}
    {applications?.length === 0 && <p className="rounded-xl border border-tp-hairline p-6 text-sm text-tp-steel">No connected applications. Add the ORBIT MCP URL in your assistant to connect.</p>}
    {applications?.map(app => <article key={app._id} className="rounded-xl border border-tp-hairline bg-tp-canvas p-5">
      <div className="flex items-start justify-between gap-4"><h3 className="break-words font-medium text-tp-ink">{app.clientName}</h3>
        <button disabled={busy !== null} onClick={() => revoke(app._id)} className="cursor-pointer rounded-lg border border-tp-hairline px-3 py-2 text-sm text-tp-ink hover:bg-tp-surface disabled:opacity-50">{busy === app._id ? 'Revoking…' : 'Revoke'}</button></div>
      <ul className="mt-3 space-y-1 text-xs text-tp-slate">{app.scopes.map(scope => <li key={scope.organizationId}><span className="break-words">{scope.organizationName || scope.organizationId}</span> · {scope.scope}</li>)}</ul>
      <p className="mt-4 text-xs text-tp-steel">Last used: {app.lastUsedAt ? new Date(app.lastUsedAt).toLocaleString() : 'Never'}</p>
    </article>)}
  </section>;
}
