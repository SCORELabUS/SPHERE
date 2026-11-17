import type { ReactNode } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAuth: vi.fn(() => {
    throw new Error('the anonymous page must not read the session');
  }),
  addRecentPricing: vi.fn(),
  renderer: vi.fn(),
}));
const TOKEN = 'Abc_DEF-ghi_jklmnopqrstuvwxyz012';

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: TOKEN }), useNavigate: () => mocks.navigate }));
vi.mock('react-helmet-async', () => ({ Helmet: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../../../auth/hooks/useAuth', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../../core/hooks/useRecentItems', () => ({ useRecentItems: () => ({ addRecentPricing: mocks.addRecentPricing }) }));
vi.mock('../../../pricing-editor/components/pricing-renderer', () => ({
  PricingRenderer: (props: { pricing: { saasName: string } }) => {
    mocks.renderer(props);
    return <div data-testid="renderer">{props.pricing.saasName}</div>;
  },
}));
vi.mock('../../components/pricing-tree', () => ({ default: () => <div data-testid="tree" /> }));
vi.mock('../../components/yaml-source-panel', () => ({ default: ({ yamlText }: { yamlText: string }) => <pre data-testid="yaml">{yamlText}</pre> }));
vi.mock('../../utils/pricing-text', () => ({
  parsePricingText: async (text: string) => ({ saasName: /saasName: (.*)/.exec(text)?.[1] ?? 'Pricing' }),
  applyVariablesToYaml: (yaml: string) => yaml,
}));

const { default: AnonymousPricingPage } = await import('.');

const ORGANIZATION_ID = '64b7f0c2a1b2c3d4e5f60718';
const PRICING_ID = '64b7f0c2a1b2c3d4e5f60719';
const VERSION_ID = '64b7f0c2a1b2c3d4e5f60720';
const shown = {
  version: '2024.1',
  createdAt: '2024-03-05T00:00:00.000Z',
  analytics: { configurationSpaceSize: 12, minSubscriptionPrice: 0, maxSubscriptionPrice: 49.5, numberOfPlans: 3 },
  yaml: 'saasName: Acme Cloud\nversion: "2024.1"\n',
};

type Node = ReactTestRenderer['root'];
const textOf = (node: Node): string => node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');

async function render(response: Response) {
  const request = vi.fn(async () => response);
  vi.stubGlobal('fetch', request);
  let view: ReactTestRenderer;
  await act(async () => {
    view = create(<AnonymousPricingPage />);
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return { view: view!, request };
}

describe('Anonymous pricing page', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('shows the cards, the figures, the analytics and the YAML of the version, with its label and date (CA-14.1, CA-14.3)', async () => {
    const { view } = await render(Response.json(shown));
    const content = textOf(view.root);
    expect(view.root.findByProps({ 'data-testid': 'renderer' })).toBeDefined();
    expect(mocks.renderer.mock.lastCall?.[0].pricing.saasName).toBe('Acme Cloud');
    expect(view.root.findByProps({ 'data-testid': 'tree' })).toBeDefined();
    expect(textOf(view.root.findByProps({ 'data-testid': 'yaml' }))).toBe(shown.yaml);
    for (const words of ['Configurations', '12', 'Min price', '$0.00', 'Max price', '$49.50', 'Version 2024.1', 'Released']) {
      expect(content).toContain(words);
    }
    expect(textOf(view.root.findByType('h1'))).toBe('Acme Cloud');
  });

  it('asks the API only for this token, without credentials, and never moves elsewhere (CA-14.4, CA-16.6, CA-19.2)', async () => {
    const { request } = await render(Response.json(shown));
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/anonymous-pricings/${TOKEN}$`));
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect((init.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('reads no session and records nothing, even for the owner (CA-19.1, CA-19.3)', async () => {
    await render(Response.json(shown));
    expect(mocks.useAuth).not.toHaveBeenCalled();
    expect(mocks.addRecentPricing).not.toHaveBeenCalled();
  });

  it('has nothing that names or leads to who published the pricing (CA-15.1-15.8)', async () => {
    const { view } = await render(Response.json(shown));
    const content = textOf(view.root);
    for (const absent of ['Forked from', 'Follow', 'Fork', 'New version', 'Settings', 'Get pricing', 'Versions', 'Collection', 'Harvey', ORGANIZATION_ID, PRICING_ID, VERSION_ID]) {
      expect(content, absent).not.toContain(absent);
    }
    const forbidden = ['/pricings/', '/orgs/', '/collections/', '/p/', '/c/', '/static/', '/public/pricings/'];
    for (const node of view.root.findAll(candidate => typeof candidate.props.href === 'string' || typeof candidate.props.src === 'string')) {
      const target = String(node.props.href ?? node.props.src);
      for (const prefix of forbidden) expect(target.startsWith(prefix), target).toBe(false);
    }
    const download = view.root.findByProps({ download: true });
    expect(download.props.href).toMatch(new RegExp(`/anonymous-pricings/${TOKEN}/yaml$`));
    expect(download.props.referrerPolicy).toBe('no-referrer');
    expect(download.props.className).toContain('cursor-pointer');
  });

  it('keeps itself out of search engines and sends no Referer (CA-20.1)', async () => {
    const { view } = await render(Response.json(shown));
    const metas = view.root.findAllByType('meta').map(meta => `${meta.props.name}=${meta.props.content}`);
    expect(metas).toEqual(expect.arrayContaining(['robots=noindex, nofollow', 'referrer=no-referrer']));
  });

  it('says only that the link is not available when it shows nothing (CA-17.6)', async () => {
    const { view } = await render(Response.json({ error: 'Link not available' }, { status: 404 }));
    const status = view.root.findByProps({ role: 'status' });
    expect(textOf(status)).toBe('This link is not available');
    expect(textOf(view.root)).not.toContain('Version');
  });

  it('asks to try again later when there were too many requests', async () => {
    const { view } = await render(new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }));
    const status = view.root.findByProps({ role: 'status' });
    expect(textOf(status)).toContain('Too many requests. Try again in 7 seconds.');
    expect(status.findByType('button').props.className).toContain('cursor-pointer');
  });
});
