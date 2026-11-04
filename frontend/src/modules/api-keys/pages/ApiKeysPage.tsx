import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { ApiKeySummary, CreateApiKeyData } from '../api/apiKeysApi';
import ApiKeyList from '../components/ApiKeyList';
import CreateApiKeyDialog from '../components/CreateApiKeyDialog';
import BlockAlert from '../../core/components/block-alert';
import Iconify from '../../core/components/iconify';

export default function ApiKeysPage() {
  const { authUser, fetchWithInterceptor } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newKeyPlain, setNewKeyPlain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const username = authUser.user?.username || '';

  const fetchRef = useRef(fetchWithInterceptor);
  fetchRef.current = fetchWithInterceptor;
  const usernameRef = useRef(username);
  usernameRef.current = username;

  const loadData = useCallback(async () => {
    const u = usernameRef.current;
    if (!u) return;
    setLoading(true);
    setError(null);
    try {
      const keys = await fetchRef
        .current(`${import.meta.env.VITE_API_URL}/users/${u}/api-keys`)
        .then((res) => res.json());
      setApiKeys(keys);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const u = usernameRef.current;
    if (!u) return;
    let cancelled = false;
    setLoading(true);
    fetchRef
      .current(`${import.meta.env.VITE_API_URL}/users/${u}/api-keys`)
      .then((res) => res.json())
      .then((keys) => {
        if (!cancelled) setApiKeys(keys);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'Failed to load data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const handleCreate = async (data: CreateApiKeyData) => {
    const response = await fetchRef.current(
      `${import.meta.env.VITE_API_URL}/users/${usernameRef.current}/api-keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    ).then((res) => res.json());

    setNewKeyPlain(response.plainKey);
    await loadData();
  };

  const handleRevoke = async (keyId: string) => {
    await fetchRef.current(
      `${import.meta.env.VITE_API_URL}/users/${usernameRef.current}/api-keys/${keyId}/revoke`,
      { method: 'PUT' }
    );
    await loadData();
  };

  const handleDelete = async (keyId: string) => {
    await fetchRef.current(
      `${import.meta.env.VITE_API_URL}/users/${usernameRef.current}/api-keys/${keyId}`,
      { method: 'DELETE' }
    );
    await loadData();
  };

  const handleCopyKey = async () => {
    if (!newKeyPlain) return;
    try {
      await navigator.clipboard.writeText(newKeyPlain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = newKeyPlain;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-tp-ink">API Keys</h1>
        <p className="mt-1 text-sm text-tp-steel">
          Create and manage API keys for programmatic access to SPHERE.
        </p>
      </div>

      {newKeyPlain && (
        <BlockAlert
          variant="warning"
          className="mb-6"
          onDismiss={() => {
            setNewKeyPlain(null);
            setCopied(false);
          }}
        >
          <div>
            <p className="mb-2 font-medium">Your API key has been created</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-tp-surface p-2 text-sm">
                {newKeyPlain}
              </code>
              <button
                type="button"
                onClick={handleCopyKey}
                className="cursor-pointer shrink-0 rounded-md border border-tp-severity-warning-border bg-tp-severity-warning-bg p-1.5 text-tp-severity-warning transition-colors hover:bg-tp-severity-warning-border/20"
                title={copied ? 'Copied' : 'Copy key'}
              >
                <Iconify icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />
              </button>
            </div>
            <p className="mt-2 text-sm">
              Copy this key now. You won't be able to see it again.
            </p>
          </div>
        </BlockAlert>
      )}

      {error && (
        <BlockAlert variant="error" className="mb-6">
          {error}
        </BlockAlert>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-tp-ink">Your API Keys</h2>
        <button
          type="button"
          onClick={() => setShowCreateDialog(true)}
          className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-sm font-medium text-tp-on-primary transition-colors hover:bg-tp-primary/90"
        >
          Create new API key
        </button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-tp-hairline bg-tp-canvas p-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-tp-primary border-t-transparent" />
          <p className="mt-3 text-sm text-tp-steel">Loading...</p>
        </div>
      ) : (
        <ApiKeyList
          keys={apiKeys}
          onRevoke={handleRevoke}
          onDelete={handleDelete}
        />
      )}

      <CreateApiKeyDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
