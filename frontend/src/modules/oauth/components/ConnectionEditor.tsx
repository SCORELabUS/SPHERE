import { useEffect, useRef, useState } from 'react';
import { FiArrowLeft, FiShield } from 'react-icons/fi';
import OrganizationSearchInput, { type OrgSearchResult } from '../../core/components/organization-search-input';
import ScopeSelector from '../../core/components/scope-selector';
import type { ApiKeyScope } from '../../api-keys/api/apiKeysApi';
import type { ConnectedApplication } from '../api/oauthApi';

export default function ConnectionEditor({ applications, token, onSave, onRevoke, onClose, onDirtyChange }: {
  applications: ConnectedApplication[]; token: string;
  onSave: (id: string, scopes: ApiKeyScope[]) => Promise<void>;
  onRevoke: (id: string) => Promise<void>; onClose: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState(applications[0]._id);
  const app = applications.find(application => application._id === selected) || applications[0];
  const [organizations, setOrganizations] = useState<OrgSearchResult[]>([]);
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (loaded.current === app._id) return;
    loaded.current = app._id;
    setOrganizations(app.scopes.map(scope => ({ id: scope.organizationId, name: scope.organizationName || scope.organizationId, displayName: scope.organizationName || scope.organizationId })));
    setScopes(app.scopes.map(({ organizationId, scope }) => ({ organizationId, scope })));
    setError(''); setConfirmDisconnect(false);
  }, [app]);
  const dirty = JSON.stringify([...scopes].sort((a, b) => a.organizationId.localeCompare(b.organizationId))) !==
    JSON.stringify(app.scopes.map(({ organizationId, scope }) => ({ organizationId, scope })).sort((a, b) => a.organizationId.localeCompare(b.organizationId)));
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  function chooseOrganizations(next: OrgSearchResult[]) {
    setOrganizations(next);
    setScopes(next.map(org => scopes.find(scope => scope.organizationId === org.id) || { organizationId: org.id, scope: 'VIEW' }));
  }
  async function submit(disconnect = false) {
    if (busy || !token) return;
    setBusy(true); setError('');
    try {
      if (disconnect) await onRevoke(app._id); else await onSave(app._id, scopes);
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update connection'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Edit connection" className="space-y-6">
    <button type="button" disabled={busy} onClick={onClose} className="inline-flex cursor-pointer items-center gap-2 text-sm text-tp-steel hover:text-tp-ink"><FiArrowLeft /> Back to applications</button>
    <div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-tp-primary">Connection settings</p>
      <h2 className="break-words font-display text-3xl text-tp-ink">{app.clientName}</h2>
      <p className="mt-2 text-sm leading-relaxed text-tp-steel">Choose where your assistant can work. Changes apply to its next request, including an existing session.</p></div>
    {applications.length > 1 && <label className="block text-sm font-medium text-tp-ink">Connection
      <select value={app._id} disabled={busy || dirty} onChange={event => setSelected(event.target.value)} className="mt-2 block w-full cursor-pointer rounded-lg border border-tp-hairline bg-tp-canvas p-3 text-sm text-tp-ink disabled:opacity-50">
        {applications.map((application, index) => <option key={application._id} value={application._id}>{application.clientName} · {new Date(application.createdAt).toLocaleString()} · {index + 1}</option>)}
      </select><span className="mt-1 block text-xs font-normal text-tp-steel">Each authorization has its own permissions. Save or cancel changes before selecting another.</span>
    </label>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="rounded-xl border border-tp-hairline bg-tp-canvas p-5 sm:p-6">
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <legend className="mb-4 text-base font-semibold text-tp-ink">Organizations and access</legend>
        <OrganizationSearchInput selectedOrgs={organizations} onOrgsChange={chooseOrganizations} />
        <ScopeSelector organizations={organizations} selectedScopes={scopes} onChange={setScopes} />
        <div className="flex gap-3 rounded-lg bg-tp-surface p-4 text-xs leading-relaxed text-tp-steel"><FiShield className="mt-0.5 shrink-0" size={16} /><p>View Only can read. Management allows changes in that organization. All also includes its sub-organizations. Your own SPHERE permissions always apply.</p></div>
        {!scopes.length && <p className="text-sm text-tp-steel">Choose at least one organization, or disconnect to remove all access.</p>}
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm text-tp-severity-error">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="cursor-pointer rounded-lg border border-tp-hairline px-4 py-2.5 text-sm text-tp-ink hover:bg-tp-surface disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={busy || !dirty || !scopes.length} className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary hover:bg-tp-primary-deep disabled:opacity-50">{busy ? 'Saving…' : 'Save permissions'}</button>
      </div>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-tp-hairline p-5">
      <div><h3 className="text-sm font-medium text-tp-ink">Disconnect application</h3><p className="mt-1 text-xs text-tp-steel">Immediately stops this authorization. You can connect again later.</p></div>
      {confirmDisconnect ? <div className="flex items-center gap-3"><button type="button" disabled={busy} onClick={() => setConfirmDisconnect(false)} className="cursor-pointer text-sm text-tp-steel">Keep connection</button><button type="button" disabled={busy} onClick={() => void submit(true)} className="cursor-pointer rounded-lg bg-tp-severity-error px-4 py-2.5 text-sm font-medium text-tp-on-primary disabled:opacity-50">{busy ? 'Disconnecting…' : 'Confirm disconnect'}</button></div>
        : <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)} className="cursor-pointer rounded-lg border border-tp-hairline px-4 py-2.5 text-sm text-tp-ink hover:border-tp-severity-error hover:text-tp-severity-error">Disconnect</button>}
    </div>
  </section>;
}
