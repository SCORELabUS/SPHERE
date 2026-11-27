import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnonymousPricingError, fetchAnonymousPricing, useAnonymousLinksApi } from './anonymousLinksApi';

vi.mock('../../auth/hooks/useAuth', () => ({ useAuth: () => ({
  authUser: { token: 'owner-token', user: { username: 'owner' } },
  fetchWithInterceptor: (url: string, init: RequestInit) => fetch(url, init),
}) }));

describe('anonymous links client', () => {
  let view: ReactTestRenderer;
  let api: ReturnType<typeof useAnonymousLinksApi>;
  function Probe() { api = useAnonymousLinksApi(); return null; }
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  it('reads what a link shows without credentials, cookies or Referer (CA-19.2)', async () => {
    const request = vi.fn(async () => Response.json({ version: '1', createdAt: '', analytics: {}, yaml: '' }));
    vi.stubGlobal('fetch', request);
    await fetchAnonymousPricing('token/with?odd#chars');
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/anonymous-pricings\/token%2Fwith%3Fodd%23chars$/);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(init.headers).toBeUndefined();
  });

  it('tells a missing link from too many requests', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Link not available' }, { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '30' } })));
    await expect(fetchAnonymousPricing('a')).rejects.toMatchObject({ status: 404 });
    const limited = await fetchAnonymousPricing('a').catch(error => error);
    expect(limited).toBeInstanceOf(AnonymousPricingError);
    expect(limited).toMatchObject({ status: 429, retryAfter: 30 });
  });

  it('manages the links of a pricing with the session', async () => {
    const request = vi.fn(async (_url: string, init: RequestInit) =>
      init.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ links: [], limit: 20 }));
    vi.stubGlobal('fetch', request);
    act(() => { view = create(<Probe />); });

    await api.listAnonymousLinks('pricing id');
    await api.createAnonymousLink('version');
    await api.revokeAnonymousLink('link');
    const calls = request.mock.calls.map(([url, init]) => [url.replace(/^.*\/pricing-anonymous-links/, ''), init.method ?? 'GET', (init.headers as Record<string, string>).Authorization]);
    expect(calls).toEqual([
      ['?pricingId=pricing%20id', 'GET', 'Bearer owner-token'],
      ['', 'POST', 'Bearer owner-token'],
      ['/link', 'DELETE', 'Bearer owner-token'],
    ]);
    expect(JSON.parse(String(request.mock.calls[1][1].body))).toEqual({ versionId: 'version' });
  });

  it('rejects with the error the API gave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'CONFLICT: A private version cannot be shared' }, { status: 409 })));
    act(() => { view = create(<Probe />); });
    await expect(api.createAnonymousLink('version')).rejects.toEqual({ status: 409, message: 'CONFLICT: A private version cannot be shared' });
  });
});
