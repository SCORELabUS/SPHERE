let pending: Promise<{ token: string; tokenExpiration: string }> | undefined;
export function identitySession() {
  if (!pending)
    pending = fetch(import.meta.env.VITE_API_URL + '/auth/identity/session', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async response => {
        const value = await response.json();
        if (!response.ok)
          throw Object.assign(new Error(value.error || 'Unable to renew your session.'), {
            status: response.status,
          });
        return value as { token: string; tokenExpiration: string };
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}
export const jwtExpiration = (token: string) => {
  try {
    const value = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
    return typeof value === 'number' ? new Date(value * 1000) : null;
  } catch {
    return null;
  }
};

export function isIdentityToken(token: string) {
  try {
    return (
      typeof JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        .identitySessionId === 'string'
    );
  } catch {
    return false;
  }
}
