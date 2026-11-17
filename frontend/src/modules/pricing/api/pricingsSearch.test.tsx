import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePricingsApi } from './pricingsApi';

const auth = vi.hoisted(() => ({
  // Adds the session when there is one, as the real interceptor does.
  fetchWithInterceptor: vi.fn((url: string, init: RequestInit) => fetch(url, init)),
}));
vi.mock('../../auth/hooks/useAuth', () => ({ useAuth: () => ({ authUser: { token: 'owner', user: { username: 'owner' } }, fetchWithInterceptor: auth.fetchWithInterceptor }) }));

describe('pricing search', () => {
  let view: ReactTestRenderer;
  let api: ReturnType<typeof usePricingsApi>;
  function Probe() { api = usePricingsApi(); return null; }
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
    auth.fetchWithInterceptor.mockClear();
  });

  it('searches with the session, so a signed-in user also finds the unlisted pricings they may read (I-2, CA-5)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ pricings: [], total: 0 })));
    act(() => { view = create(<Probe />); });
    await api.getPricings({ name: 'slack', limit: 12, offset: 0 });
    expect(auth.fetchWithInterceptor).toHaveBeenCalledOnce();
    expect(auth.fetchWithInterceptor.mock.calls[0][0]).toMatch(/\/pricings\?name=slack&limit=12&offset=0$/);
  });
});
