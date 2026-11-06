import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVersionChanges, type ChangesState, type ChangesTarget } from './use-version-changes';

const auth = vi.hoisted(() => ({ token: 'first-user' }));
vi.mock('../../../auth/hooks/useAuth', () => ({ useAuth: () => ({ authUser: auth }) }));
vi.mock('../../../core/utils/pricing-yaml', () => ({
  pricingYamlRequestInit: (_url: string, token: string) => ({ headers: { Authorization: `Bearer ${token}` } }),
}));
vi.mock('../../utils/version-yaml', () => ({ versionYamlUrl: (url: string) => url }));

describe('version change cache', () => {
  let view: ReactTestRenderer;
  let latest: ChangesState;
  let target: ChangesTarget | null;
  let revision: object;
  let files: Record<string, string>;
  const fetchYaml = vi.fn();
  function Probe() {
    latest = useVersionChanges(target, revision);
    return null;
  }
  const render = async () => {
    await act(async () => {
      if (view) view.update(<Probe />);
      else view = create(<Probe />);
      await vi.advanceTimersByTimeAsync(151);
    });
  };
  const additions = () => {
    if (latest.status !== 'ready') throw new Error(`Expected ready, got ${latest.status}`);
    return latest.summary.sections.flatMap(section => section.added);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('fetch', fetchYaml);
    fetchYaml.mockReset().mockImplementation(async (url: string) => ({ ok: true, text: async () => files[url] }));
    auth.token = 'first-user';
    revision = {};
    target = { key: 'pricing-v3', before: 'v2.yml', after: 'v3.yml' };
    files = { 'v1.yml': 'plans: {}', 'v2.yml': 'plans: { Pro: { price: 1 } }',
      'v3.yml': 'plans: { Pro: { price: 2 }, Enterprise: { price: 5 } }' };
  });
  afterEach(() => {
    act(() => view?.unmount());
    view = undefined as unknown as ReactTestRenderer;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reuses a comparison within the same graph snapshot', async () => {
    await render();
    expect(additions()).toEqual(['Enterprise']);
    target = null;
    await render();
    target = { key: 'pricing-v3', before: 'v2.yml', after: 'v3.yml' };
    await render();
    expect(additions()).toEqual(['Enterprise']);
    expect(fetchYaml).toHaveBeenCalledTimes(2);
  });

  it('compares again when the previous version is deleted', async () => {
    await render();
    target = { key: 'pricing-v3', before: 'v1.yml', after: 'v3.yml' };
    await render();
    expect(additions()).toEqual(['Pro', 'Enterprise']);
  });

  it('refreshes files and summaries when the graph is refreshed', async () => {
    await render();
    files['v3.yml'] = 'plans: { Pro: { price: 2 }, Team: { price: 3 } }';
    revision = {};
    await render();
    expect(additions()).toEqual(['Team']);
    expect(fetchYaml).toHaveBeenCalledTimes(4);
  });

  it('does not reuse another credential\'s cached YAML or summary', async () => {
    await render();
    auth.token = 'second-user';
    fetchYaml.mockResolvedValue({ ok: false });
    await render();
    expect(latest.status).toBe('error');
    expect(fetchYaml).toHaveBeenLastCalledWith(expect.any(String), { headers: { Authorization: 'Bearer second-user' } });
  });

  it('ignores an old in-flight result after the graph changes', async () => {
    let finish!: (value: { ok: boolean; text: () => Promise<string> }) => void;
    fetchYaml.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    expect(latest.status).toBe('loading');
    revision = {};
    files['v3.yml'] = 'plans: { Pro: { price: 2 }, Team: { price: 3 } }';
    await render();
    expect(additions()).toEqual(['Team']);
    await act(async () => { finish({ ok: true, text: async () => 'plans: {}' }); });
    expect(additions()).toEqual(['Team']);
  });
});
