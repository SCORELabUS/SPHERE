const KEY = 'sphere.oauth.pending';

export function rememberConsent(request: string, kind: 'oauth' | 'oidc' = 'oauth') {
  sessionStorage.setItem(KEY, JSON.stringify({ request, kind, expires: Date.now() + 10 * 60 * 1000 }));
}

export function consumeConsentReturn(): string | null {
  const value = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  if (!value) return null;
  try {
    const { request, kind, expires } = JSON.parse(value);
    if (typeof request === 'string' && /^[a-f0-9]{64}$/.test(request) && expires > Date.now()) {
      return (kind === 'oidc' ? '/oidc' : '/oauth') + '/consent?request=' + request;
    }
  } catch { /* Ignore expired or malformed local state. */ }
  return null;
}
