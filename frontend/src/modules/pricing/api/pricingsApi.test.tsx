import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePricingsApi } from './pricingsApi';

vi.mock('../../auth/hooks/useAuth', () => ({ useAuth: () => ({
  authUser: { token: 'owner', user: { username: 'owner' } }, fetchWithInterceptor: fetch,
}) }));

describe('pricing collection lookup', () => {
  let view: ReactTestRenderer;
  let api: ReturnType<typeof usePricingsApi>;
  function Probe() { api = usePricingsApi(); return null; }
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  it('keeps the selected family and its revision ETag', async () => {
    const body = { pricingId: 'spectra-buffer', collection: { id: 'spectra', slug: 'spectra' }, versions: [{ private: true }] };
    const request = vi.fn(async (_url: string) => Response.json(body, { headers: { ETag: '"spectra.7"' } }));
    vi.stubGlobal('fetch', request);
    act(() => { view = create(<Probe />); });
    expect(await api.getPricingBySlug('buffer', 'athena', 'spectra')).toEqual({ ...body, etag: '"spectra.7"' });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toContain('?collection=spectra');
  });

  it('does not substitute another visible collection after a 404', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Pricing not found' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ collection: { id: 'icsoc', slug: 'icsoc' }, versions: [] })));
    act(() => { view = create(<Probe />); });
    await expect(api.getPricingBySlug('buffer', 'athena', 'spectra')).rejects.toEqual({ message: 'Pricing not found' });
  });

  it('still loads public versions when the collection is hidden from the visitor', async () => {
    const publicPricing = { collection: { id: null }, versions: [{ private: false }] };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Pricing not found' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(publicPricing)));
    act(() => { view = create(<Probe />); });
    expect(await api.getPricingBySlug('buffer', 'athena', 'hidden')).toEqual(publicPricing);
  });

  it('requests the version graph of the same collection', async () => {
    const request = vi.fn(async (_url: string) => Response.json({ pricingId: 'spectra-buffer', lanes: [] }));
    vi.stubGlobal('fetch', request);
    act(() => { view = create(<Probe />); });
    await api.getPricingGraph('athena', 'buffer', undefined, 'spectra-v1.2');
    expect(request.mock.calls[0][0]).toContain('/pricing-graphs/athena/buffer?collection=spectra-v1.2');
  });
});
