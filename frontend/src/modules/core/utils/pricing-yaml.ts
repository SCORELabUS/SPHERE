/**
 * The YAML file of a private pricing version is only served to callers who may
 * read that version, so SPHERE's own pages send the session token with the
 * request. The token is only attached to SPHERE's own hosts (this page or the
 * API), never to a pricing URL that points somewhere else.
 */
export function pricingYamlRequestInit(url: string, token?: string | null): RequestInit {
  if (!token || token === 'null') return {};

  try {
    const target = new URL(url, window.location.origin);
    const api = new URL(import.meta.env.VITE_API_URL ?? '/', window.location.origin);
    const isSphereHost =
      target.hostname === window.location.hostname || target.origin === api.origin;
    return isSphereHost ? { headers: { Authorization: `Bearer ${token}` } } : {};
  } catch {
    return {};
  }
}
