import { useCallback, useEffect, useRef, useState } from 'react';
import { FiCheck, FiEdit2, FiLink, FiRefreshCw, FiShield } from 'react-icons/fi';
import { SiClaude, SiOpenai } from 'react-icons/si';
import { useAuth } from '../../auth/hooks/useAuth';
import { oauthApi, type ConnectedApplication } from '../api/oauthApi';
import type { ApiKeyScope } from '../../api-keys/api/apiKeysApi';
import { assistantNames, assistantOf, type Assistant } from '../utils/connections';
import ConnectionGuide from './ConnectionGuide';
import ConnectionEditor from './ConnectionEditor';

const assistants: Assistant[] = ['claude', 'openai'];

export default function ConnectedApplications({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { authUser } = useAuth();
  const token = authUser.token;
  const [applications, setApplications] = useState<ConnectedApplication[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const [guide, setGuide] = useState<Assistant | null>(null);
  const [editing, setEditing] = useState<string[] | null>(null);
  const alive = useRef(false);
  const requestNumber = useRef(0);
  const reload = useCallback(async () => {
    if (!token) return;
    const number = ++requestNumber.current;
    setChecking(true);
    try {
      const value = await oauthApi<ConnectedApplication[]>('/grants', token);
      if (alive.current && number === requestNumber.current) { setApplications(value); setError(''); }
      return value;
    } catch (err) {
      if (alive.current && number === requestNumber.current) setError(err instanceof Error ? err.message : 'Unable to load connections');
    } finally { if (alive.current && number === requestNumber.current) setChecking(false); }
  }, [token]);
  useEffect(() => {
    requestNumber.current += 1;
    alive.current = true;
    setApplications(null); setEditing(null); setGuide(null); setNotice('');
    void reload();
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { alive.current = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [reload]);

  async function save(id: string, scopes: ApiKeyScope[]) {
    if (!token) return;
    await oauthApi(`/grants/${id}`, token, 'PUT', { scopes });
    setApplications(current => current?.map(app => app._id === id ? { ...app, scopes } : app) || []);
    setNotice('Permissions updated. Your assistant will use them on its next request.');
    void reload();
  }
  async function revoke(id: string) {
    if (!token) return;
    await oauthApi(`/grants/${id}`, token, 'DELETE');
    setApplications(current => current?.filter(app => app._id !== id) || []);
    setNotice('Application disconnected. Its access has stopped.');
  }
  const edited = applications?.filter(app => editing?.includes(app._id)) || [];
  if (editing && edited.length && token) return <ConnectionEditor key={editing.join(':')} applications={edited} token={token} onSave={save} onRevoke={revoke} onClose={() => setEditing(null)} onDirtyChange={onDirtyChange} />;
  const unknown = applications?.filter(app => !assistantOf(app.clientName)) || [];
  return <section aria-label="Connected applications" className="space-y-6">
    <div className="flex items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-tp-primary">SPHERE, wherever you work</p>
        <h2 className="font-display text-3xl tracking-tight text-tp-ink">Your assistants. Your access.</h2>
        <p className="mt-3 max-w-[36rem] text-sm leading-relaxed text-tp-steel">Bring your organizations and pricings into the assistants you use. Connect once, then decide exactly where each one can work.</p></div>
      <button type="button" onClick={() => void reload()} disabled={checking} aria-label="Refresh connections" title="Refresh connections" className="cursor-pointer rounded-lg border border-tp-hairline p-2.5 text-tp-steel hover:bg-tp-surface focus-visible:outline-2 focus-visible:outline-tp-primary disabled:opacity-50"><FiRefreshCw className={checking ? 'animate-spin' : ''} size={16} /></button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-tp-hairline bg-tp-surface p-4 text-sm text-tp-severity-error">{error} <button type="button" onClick={() => void reload()} className="ml-2 cursor-pointer underline">Try again</button></div>}
    {notice && <p role="status" className="text-sm text-tp-primary">{notice}</p>}
    {!applications && !error && <p role="status" className="text-sm text-tp-steel">Loading connections…</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {assistants.map(assistant => {
        const connected = applications?.filter(app => assistantOf(app.clientName) === assistant) || [];
        const count = connected.length;
        const Logo = assistant === 'claude' ? SiClaude : SiOpenai;
        const edit = () => { setEditing(connected.map(app => app._id)); setNotice(''); };
        return <article key={assistant} aria-label={assistantNames[assistant]} className={`group relative flex min-h-72 flex-col rounded-xl border-2 bg-tp-canvas p-6 transition-colors ${count ? 'border-tp-primary' : 'border-tp-hairline hover:border-tp-hairline-strong'}`}>
          {count > 0 && <button type="button" aria-label={`Edit ${assistantNames[assistant]} connection`} onClick={edit} className="absolute right-3 top-3 cursor-pointer rounded-lg p-2.5 text-tp-steel opacity-100 transition-opacity hover:bg-tp-surface hover:text-tp-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-tp-primary sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><FiEdit2 size={16} /></button>}
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-tp-hairline bg-tp-surface text-tp-ink"><Logo size={30} aria-hidden="true" /></div>
          <h3 className="text-xl font-semibold tracking-tight text-tp-ink">{assistant === 'claude' ? 'Claude' : 'ChatGPT'}</h3>
          <p className="mt-2 text-sm leading-relaxed text-tp-steel">{assistant === 'claude' ? 'Explore your pricings and manage your workspace, right from Claude.' : 'Take SPHERE into ChatGPT or your coding workflow with Codex.'}</p>
          <p className="mb-5 mt-4 text-xs text-tp-steel">{count ? `${count} active ${count === 1 ? 'connection' : 'connections'} · Access is yours to manage` : 'Connect with your SPHERE account'}</p>
          <button type="button" disabled={!applications} aria-label={count ? `Manage ${assistantNames[assistant]} connection` : `Connect ${assistantNames[assistant]}`} onClick={() => { if (count) edit(); else { setGuide(assistant); setNotice(''); } }} aria-expanded={count ? undefined : guide === assistant} aria-controls={count ? undefined : 'assistant-connection-guide'} className={`mt-auto flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tp-primary disabled:opacity-50 ${count ? 'border-tp-primary bg-tp-primary text-tp-on-primary hover:bg-tp-primary-deep' : 'border-dashed border-tp-hairline-strong text-tp-ink hover:border-tp-primary hover:bg-tp-primary/5 hover:text-tp-primary'}`}>
            {count ? <><FiCheck size={16} /> Connected</> : <><FiLink size={16} /> Connect</>}
          </button>
        </article>;
      })}
    </div>
    {guide && <div id="assistant-connection-guide"><ConnectionGuide key={guide} assistant={guide} checking={checking} onClose={() => setGuide(null)} onRefresh={async () => { const value = await reload(); if (value) setNotice(value.some(app => assistantOf(app.clientName) === guide) ? 'Connection found. You can now manage its access.' : 'No active connection yet. Finish authorizing in your assistant, then check again.'); }} /></div>}
    {unknown.length > 0 && <div className="space-y-3"><h3 className="text-sm font-semibold text-tp-ink">Other connected applications</h3>{unknown.map(app => <article key={app._id} className="flex items-center justify-between gap-4 rounded-xl border border-tp-hairline bg-tp-canvas p-4"><div className="min-w-0"><p className="break-words text-sm font-medium text-tp-ink">{app.clientName}</p><p className="mt-1 text-xs text-tp-steel">{app.scopes.length} organizations · Connected</p></div><button type="button" onClick={() => setEditing([app._id])} aria-label={`Edit ${app.clientName} connection`} className="cursor-pointer rounded-lg border border-tp-hairline p-2.5 text-tp-steel hover:text-tp-primary"><FiEdit2 size={16} /></button></article>)}</div>}
    <div className="flex items-start gap-3 border-t border-tp-hairline pt-5 text-xs leading-relaxed text-tp-steel"><FiShield className="mt-0.5 shrink-0 text-tp-primary" size={16} /><p>You stay in control. Each connection uses your SPHERE permissions, and you can change its access or disconnect it at any time.</p></div>
  </section>;
}
