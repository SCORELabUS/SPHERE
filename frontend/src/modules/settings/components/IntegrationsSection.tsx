import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FiCheck,
  FiKey,
  FiLink,
  FiLoader,
  FiLock,
  FiShield,
  FiTrash2,
} from 'react-icons/fi';
import { useSearchParams } from 'react-router-dom';
import customConfirm from '../../core/utils/custom-confirm';
import {
  AuthenticationMethods,
  ConnectedIdentity,
  useUserSettingsApi,
} from '../api/userSettingsApi';

const PROVIDERS = [
  {
    key: 'google' as const,
    identityKey: 'google' as const,
    name: 'Google',
    description: 'Use your Google account to access SPHERE.',
  },
  {
    key: 'us' as const,
    identityKey: 'us-sso' as const,
    name: 'Universidad de Sevilla',
    description: 'Sign in securely with your UVUS identity.',
  },
];

const LINK_ERRORS: Record<string, string> = {
  identity_in_use: 'That identity already belongs to another SPHERE account. Delete that account first, then connect the identity here.',
  provider_already_connected: 'Disconnect the current account for this provider before connecting another one.',
  invalid_state: 'The connection request expired. Please try again.',
  server_error: 'SPHERE could not connect the identity. Please try again.',
};

export default function IntegrationsSection() {
  const api = useUserSettingsApi();
  const apiRef = useRef(api);
  const [searchParams, setSearchParams] = useSearchParams();
  const [methods, setMethods] = useState<AuthenticationMethods | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const loadMethods = useCallback(async () => {
    setLoading(true);
    try {
      setMethods(await apiRef.current.getAuthenticationMethods());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sign-in methods');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMethods();
  }, [loadMethods]);

  useEffect(() => {
    const linked = searchParams.get('identity_linked');
    const linkError = searchParams.get('identity_error');
    if (!linked && !linkError) return;

    if (linked) {
      const providerName = linked === 'us' ? 'Universidad de Sevilla' : 'Google';
      setNotice(`${providerName} is now connected to your SPHERE account.`);
    }
    if (linkError) setError(LINK_ERRORS[linkError] ?? LINK_ERRORS.server_error);

    const next = new URLSearchParams(searchParams);
    next.delete('identity_linked');
    next.delete('identity_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const connect = async (provider: 'google' | 'us') => {
    setBusyProvider(provider);
    setError(null);
    setNotice(null);
    try {
      const url = await api.initiateIdentityLink(provider);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start identity connection');
      setBusyProvider(null);
    }
  };

  const disconnect = async (provider: 'google' | 'us', name: string) => {
    try {
      await customConfirm(
        `Disconnect ${name}? You will no longer be able to use it to sign in to SPHERE.`,
        { danger: true, confirmLabel: 'Disconnect' }
      );
    } catch {
      return;
    }

    setBusyProvider(provider);
    setError(null);
    setNotice(null);
    try {
      setMethods(await api.unlinkIdentity(provider));
      setNotice(`${name} has been disconnected.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect identity');
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-tp-ink">Sign-in & Security</h2>
        <p className="mt-0.5 text-sm text-tp-steel">
          Bring your identities together and choose how you access SPHERE.
        </p>
      </div>

      {(error || notice) && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role={error ? 'alert' : 'status'}
          className={`flex items-start gap-3 rounded-[10px] border px-4 py-3 text-sm ${
            error
              ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
          }`}
        >
          {error ? <FiShield className="mt-0.5 h-4 w-4 shrink-0" /> : <FiCheck className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{error ?? notice}</span>
        </motion.div>
      )}

      <div className="overflow-hidden rounded-[12px] border border-tp-hairline bg-tp-canvas">
        <div className="border-b border-tp-hairline px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-tp-primary/10">
              <FiLink className="h-4 w-4 text-tp-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-tp-ink">Connected identities</h3>
              <p className="mt-0.5 text-xs text-tp-steel">Each identity can belong to only one SPHERE account.</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-tp-steel">
            <FiLoader className="h-4 w-4 animate-spin" />
            Loading sign-in methods…
          </div>
        ) : (
          <div className="divide-y divide-tp-hairline">
            {PROVIDERS.map(provider => {
              const identity = methods?.identities.find(item => item.provider === provider.identityKey);
              const busy = busyProvider === provider.key;
              return (
                <ProviderRow
                  key={provider.key}
                  name={provider.name}
                  description={provider.description}
                  provider={provider.key}
                  identity={identity}
                  busy={busy}
                  onConnect={() => connect(provider.key)}
                  onDisconnect={() => disconnect(provider.key, provider.name)}
                />
              );
            })}
          </div>
        )}
      </div>

      {!loading && methods && (
        <PasswordCard hasPassword={methods.hasPassword} onUpdated={setMethods} />
      )}
    </div>
  );
}

function ProviderRow({
  name,
  description,
  provider,
  identity,
  busy,
  onConnect,
  onDisconnect,
}: {
  name: string;
  description: string;
  provider: 'google' | 'us';
  identity?: ConnectedIdentity;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-tp-hairline bg-tp-surface">
          {provider === 'google' ? <GoogleMark /> : <FiLock className="h-5 w-5 text-tp-primary" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-tp-ink">{name}</h4>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              identity
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-tp-surface text-tp-steel'
            }`}>
              {identity ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="mt-1 text-xs text-tp-steel">
            {identity?.email ?? description}
          </p>
        </div>
      </div>

      {identity ? (
        <button
          type="button"
          onClick={onDisconnect}
          disabled={busy}
          className="flex cursor-pointer items-center justify-center gap-2 self-start rounded-[8px] border border-tp-hairline-strong px-3.5 py-2 text-xs font-medium text-tp-steel transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 sm:self-auto"
        >
          {busy ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : <FiTrash2 className="h-3.5 w-3.5" />}
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="flex cursor-pointer items-center justify-center gap-2 self-start rounded-[8px] bg-tp-primary px-3.5 py-2 text-xs font-medium text-tp-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          {busy ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : <FiLink className="h-3.5 w-3.5" />}
          Connect
        </button>
      )}
    </div>
  );
}

function InlineFeedback({ error, success }: { error: string | null; success: string | null }) {
  if (!error && !success) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      role={error ? 'alert' : 'status'}
      className={`sm:col-span-2 flex items-start gap-2 rounded-[8px] border px-3 py-2.5 text-xs ${
        error
          ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
      }`}
    >
      {error ? <FiShield className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <FiCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{error ?? success}</span>
    </motion.div>
  );
}

function PasswordCard({
  hasPassword,
  onUpdated,
}: {
  hasPassword: boolean;
  onUpdated: (methods: AuthenticationMethods) => void;
}) {
  const api = useUserSettingsApi();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    if (/\s/.test(password)) return setError('The password cannot contain spaces.');
    if (password !== confirmation) return setError('The passwords do not match.');

    setSaving(true);
    try {
      onUpdated(await api.setInitialPassword(password));
      setPassword('');
      setConfirmation('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-[12px] border border-tp-hairline bg-tp-canvas p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-tp-primary/10">
          <FiKey className="h-5 w-5 text-tp-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-tp-ink">SPHERE password</h3>
            {hasPassword && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <FiCheck className="h-3 w-3" /> Ready
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-tp-steel">
            {hasPassword
              ? 'You can sign in with your SPHERE username or email in addition to connected identities.'
              : 'Create a local password so you always have a direct way back into your account.'}
          </p>

          {hasPassword ? (
            <ChangePasswordForm onUpdated={onUpdated} />
          ) : (
            <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2">
              <PasswordInput label="New password" value={password} onChange={setPassword} />
              <PasswordInput label="Confirm password" value={confirmation} onChange={setConfirmation} />
              <InlineFeedback error={error} success={saved ? 'Password created. You can now sign in directly to SPHERE.' : null} />
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={saving || !password || !confirmation}
                  className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-tp-hairline-strong bg-tp-canvas px-4 py-2.5 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? (
                    <FiLoader className="h-4 w-4 animate-spin" />
                  ) : saved ? (
                    <FiCheck className="h-4 w-4" />
                  ) : (
                    <FiShield className="h-4 w-4" />
                  )}
                  {saved ? 'Password created' : 'Create password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangePasswordForm({
  onUpdated,
}: {
  onUpdated: (methods: AuthenticationMethods) => void;
}) {
  const api = useUserSettingsApi();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!currentPassword) return setError('Enter your current password.');
    if (newPassword.length < 8) return setError('Use at least 8 characters for your new password.');
    if (/\s/.test(newPassword)) return setError('The new password cannot contain spaces.');
    if (newPassword !== confirmation) return setError('The new passwords do not match.');

    setSaving(true);
    try {
      onUpdated(await api.changePassword({ currentPassword, newPassword }));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <PasswordInput
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
      </div>
      <PasswordInput label="New password" value={newPassword} onChange={setNewPassword} />
      <PasswordInput label="Confirm new password" value={confirmation} onChange={setConfirmation} />
      <InlineFeedback error={error} success={saved ? 'Your password has been changed.' : null} />
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={saving || !currentPassword || !newPassword || !confirmation}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-tp-hairline-strong bg-tp-canvas px-4 py-2.5 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <FiLoader className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <FiCheck className="h-4 w-4" />
          ) : (
            <FiKey className="h-4 w-4" />
          )}
          {saved ? 'Password changed' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete = 'new-password',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-tp-steel">{label}</span>
      <input
        type="password"
        value={value}
        onChange={event => onChange(event.target.value)}
        autoComplete={autoComplete}
        className="h-11 w-full rounded-md border border-tp-input-border bg-tp-input-bg px-3.5 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20"
      />
    </label>
  );
}

function GoogleMark() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.28a7.22 7.22 0 0 1 0-4.56V6.61H1.27a12.01 12.01 0 0 0 0 10.78l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}
