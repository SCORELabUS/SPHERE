import { useCallback, useMemo } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import type { AnonymousLink, AnonymousLinkList, AnonymousPricing } from '../types/anonymous-links';

const apiUrl = () => import.meta.env.VITE_API_URL ?? '';

/** Why a link showed nothing: 404 for any unavailable link, 429 with the seconds to wait. */
export class AnonymousPricingError extends Error {
  constructor(public status: number, public retryAfter?: number) {
    super(status === 404 ? 'This link is not available' : 'The pricing could not be loaded');
  }
}

/**
 * What an anonymous link shows. Sent without credentials, cookies or Referer:
 * the answer is the same for everyone, and nothing tells the server (or a
 * page the request might reach) who is looking.
 */
export async function fetchAnonymousPricing(token: string, signal?: AbortSignal): Promise<AnonymousPricing> {
  const response = await fetch(`${apiUrl()}/anonymous-pricings/${encodeURIComponent(token)}`, {
    method: 'GET',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new AnonymousPricingError(response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
  return response.json();
}

/** The YAML file a link shows, downloaded through the token (never the stored path, which names the organization). */
export function anonymousYamlUrl(token: string): string {
  return `${apiUrl()}/anonymous-pricings/${encodeURIComponent(token)}/yaml`;
}

/** The page a link opens, to share. */
export function anonymousLinkUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/a/${token}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return Promise.reject({ status: response.status, message: body.error ?? 'Request failed' });
  return body as T;
}

/** Managing the anonymous links of a pricing, for who may edit it. */
export function useAnonymousLinksApi() {
  const { fetchWithInterceptor, authUser } = useAuth();
  const token = authUser?.token;
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  const listAnonymousLinks = useCallback((pricingId: string) =>
    fetchWithInterceptor(`${apiUrl()}/pricing-anonymous-links?pricingId=${encodeURIComponent(pricingId)}`, { headers })
      .then((response: Response) => readJson<AnonymousLinkList>(response)), [fetchWithInterceptor, headers]);

  const createAnonymousLink = useCallback((versionId: string) =>
    fetchWithInterceptor(`${apiUrl()}/pricing-anonymous-links`, { method: 'POST', headers, body: JSON.stringify({ versionId }) })
      .then((response: Response) => readJson<AnonymousLink>(response)), [fetchWithInterceptor, headers]);

  const revokeAnonymousLink = useCallback((linkId: string) =>
    fetchWithInterceptor(`${apiUrl()}/pricing-anonymous-links/${encodeURIComponent(linkId)}`, { method: 'DELETE', headers })
      .then(async (response: Response) => {
        if (!response.ok) await readJson(response);
      }), [fetchWithInterceptor, headers]);

  return useMemo(
    () => ({ listAnonymousLinks, createAnonymousLink, revokeAnonymousLink }),
    [listAnonymousLinks, createAnonymousLink, revokeAnonymousLink]
  );
}
