import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CardPage from '.';
import PricingPullRequestsTab from '../../components/pricing-pull-requests';

const mocks = vi.hoisted(() => ({
  getPricingBySlug: vi.fn(),
  getPricingFollow: vi.fn(),
  getOrgMembers: vi.fn(),
  listPullRequests: vi.fn(),
  authUser: { isAuthenticated: true, token: 'token', user: { id: 'u1', username: 'alice' } } as {
    isAuthenticated: boolean;
    token: string | null;
    user: { id: string; username: string } | null;
  },
}));

vi.mock('../../api/pricingsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/pricingsApi')>()),
  usePricingsApi: () => ({ getPricingBySlug: mocks.getPricingBySlug, getPricingFollow: mocks.getPricingFollow }),
}));
vi.mock('../../api/pricingPullRequestsApi', () => ({
  usePricingPullRequestsApi: () => ({ listPullRequests: mocks.listPullRequests }),
}));
vi.mock('../../../organization/api/organizationsApi', () => ({
  useOrganizationsApi: () => ({ getOrgMembers: mocks.getOrgMembers }),
  getPublicOrganization: () => Promise.resolve({ name: 'acme', displayName: 'Acme' }),
}));
vi.mock('../../../auth/hooks/useAuth', () => ({ useAuth: () => ({ authUser: mocks.authUser }) }));
vi.mock('../../../core/hooks/useRecentItems', () => ({ useRecentItems: () => ({ addRecentPricing: () => {} }) }));
vi.mock('../../../core/hooks/useRouter', () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
// Plain elements instead of animations.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const cache = new Map<string, unknown>();
  const motion = new Proxy({}, {
    get: (_, tag: string) => {
      if (!cache.has(tag)) {
        cache.set(tag, ({ initial, animate, exit, transition, whileTap, whileHover, layoutId, ...rest }: Record<string, unknown>) => {
          void initial; void animate; void exit; void transition; void whileTap; void whileHover; void layoutId;
          return React.createElement(tag, rest);
        });
      }
      return cache.get(tag);
    },
  });
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});
// The page's sections are not what these tests look at.
vi.mock('../../../pricing-editor/components/pricing-renderer', () => ({ PricingRenderer: () => null }));
vi.mock('../../../pricing-editor/services/export.service', () => ({ downloadYaml: () => {} }));
vi.mock('../../../core/components/skeletons/pricing-card-skeleton', () => ({ default: () => null }));
vi.mock('../../../core/components/harvey-chat', () => ({ default: () => null }));
vi.mock('../../components/configuration-space-view', () => ({ default: () => null }));
vi.mock('../../components/private-access-fallback', () => ({ default: () => null }));
vi.mock('../../components/yaml-source-panel', () => ({ default: () => null }));
vi.mock('../../components/pricing-tree', () => ({ default: () => null }));
vi.mock('../../components/pricing-analytics-tab', () => ({ default: () => null }));
vi.mock('../../components/pricing-versions-tab', () => ({ default: () => null }));
vi.mock('../../components/pricing-version-graph', () => ({ default: () => null }));
vi.mock('../../components/pricing-settings-tab', () => ({ default: () => null }));
vi.mock('../../components/versions-visibility-modal', () => ({ default: () => null }));
vi.mock('../../components/pricing-link-modal', () => ({ default: () => null }));
vi.mock('../../components/pricing-import-modal', () => ({ default: () => null }));
vi.mock('../../components/get-pricing-menu', () => ({ default: () => null }));
vi.mock('../../components/new-version-menu', () => ({ default: () => null }));
vi.mock('../../components/fork-pricing-modal', () => ({ default: () => null }));
vi.mock('../../components/pricing-pull-requests', () => ({ default: () => null }));

const PRICING_ID = '6650f0c0c0c0c0c0c0c0c001';
const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';

const pricing = {
  pricingId: PRICING_ID,
  name: 'Demo',
  etag: '"tag"',
  collection: null,
  versions: [
    {
      id: 'v1', version: '1.0', createdAt: '2026-01-01', yaml: '', private: false,
      collection: null, analytics: null, forkedFrom: null,
    },
  ],
};

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

describe('pricing page tabs in the URL', () => {
  let view: ReactTestRenderer;
  let location: Location;
  let navigationType: string;
  let navigate: ReturnType<typeof useNavigate>;

  function Probe() {
    location = useLocation();
    navigationType = useNavigationType();
    navigate = useNavigate();
    return null;
  }

  async function render(search = '') {
    await act(async () => {
      view = create(
        <MemoryRouter initialEntries={[`/pricings/acme/demo${search}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/pricings/:organizationId/:slug" element={<><CardPage /><Probe /></>} />
          </Routes>
        </MemoryRouter>
      );
    });
  }

  /** The buttons of a tab: one in the phone row, one in the desktop row. */
  const tabButtons = (label: string) =>
    view.root.findAllByType('button').filter(button => button.children[0] === label);
  const pullRequestsTab = () => view.root.findAllByType(PricingPullRequestsTab);
  const query = () => Object.fromEntries(new URLSearchParams(location.search));

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authUser = { isAuthenticated: true, token: 'token', user: { id: 'u1', username: 'alice' } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    mocks.getPricingBySlug.mockResolvedValue(pricing);
    mocks.getPricingFollow.mockResolvedValue({ following: false });
    mocks.getOrgMembers.mockResolvedValue([]);
    mocks.listPullRequests.mockResolvedValue({ counts: { open: 3, merged: 0, closed: 0 } });
  });
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  it('offers no Pull requests tab without a session, even when the URL names it (CA-45)', async () => {
    mocks.authUser = { isAuthenticated: false, token: null, user: null };
    await render(`?tab=pull-requests&pr=${PR_ID}`);
    expect(tabButtons('Versions')).toHaveLength(2);
    expect(tabButtons('Pull requests')).toHaveLength(0);
    expect(pullRequestsTab()).toHaveLength(0);
    expect(mocks.listPullRequests).not.toHaveBeenCalled();
  });

  it('shows the tab in both rows with the open pull requests the caller sees', async () => {
    await render();
    expect(mocks.listPullRequests).toHaveBeenCalledWith(PRICING_ID, { status: 'open' });
    const tabs = tabButtons('Pull requests');
    expect(tabs).toHaveLength(2);
    tabs.forEach(tab => expect(textOf(tab)).toBe('Pull requests3'));
    expect(pullRequestsTab()).toHaveLength(0);
  });

  it('opens the pull request named by ?tab=pull-requests&pr= (CA-59)', async () => {
    await render(`?tab=pull-requests&pr=${PR_ID}`);
    expect(pullRequestsTab()).toHaveLength(1);
    expect(pullRequestsTab()[0].props).toMatchObject({ pricingId: PRICING_ID, selectedId: PR_ID });
  });

  it('ignores a ?pr= that is not a pull request id', async () => {
    await render('?tab=pull-requests&pr=javascript:alert(1)');
    expect(pullRequestsTab()[0].props.selectedId).toBeNull();
  });

  it('writes the tab and the pull request into the URL, replacing the entry (CA-59)', async () => {
    await render('?collection=main');
    await act(async () => tabButtons('Pull requests')[1].props.onClick());
    expect(query()).toEqual({ collection: 'main', tab: 'pull-requests' });
    expect(navigationType).toBe('REPLACE');

    await act(async () => pullRequestsTab()[0].props.onSelect(PR_ID));
    expect(query()).toEqual({ collection: 'main', tab: 'pull-requests', pr: PR_ID });
    expect(navigationType).toBe('REPLACE');
    expect(pullRequestsTab()[0].props.selectedId).toBe(PR_ID);

    await act(async () => pullRequestsTab()[0].props.onSelect(null));
    expect(query()).toEqual({ collection: 'main', tab: 'pull-requests' });
    expect(pullRequestsTab()[0].props.selectedId).toBeNull();

    await act(async () => pullRequestsTab()[0].props.onSelect(PR_ID));
    await act(async () => tabButtons('Versions')[0].props.onClick());
    expect(query()).toEqual({ collection: 'main' });
    expect(navigationType).toBe('REPLACE');
    expect(pullRequestsTab()).toHaveLength(0);
  });

  it('shares its versions and ETag with a merge, and takes the new ETag and versions after it', async () => {
    await render(`?tab=pull-requests&pr=${PR_ID}`);
    const context = () => pullRequestsTab()[0].props.context;
    expect(context()).toMatchObject({ versions: pricing.versions, etag: '"tag"' });

    const merged = { id: 'v2', version: '2.0', createdAt: '2026-02-01', yaml: '', private: false, collection: null, analytics: null, forkedFrom: null };
    let reload: (value: unknown) => void = () => {};
    mocks.getPricingBySlug.mockReturnValueOnce(new Promise(resolve => (reload = resolve)));
    await act(async () => context().onMerged({ pullRequest: {}, version: { id: 'v2', version: '2.0', private: false }, etag: '"tag.2"' }));
    // The new ETag is taken at once, so a second merge is not refused while the versions load.
    expect(context().etag).toBe('"tag.2"');
    expect(mocks.getPricingBySlug).toHaveBeenCalledTimes(2);

    await act(async () => reload({ ...pricing, etag: '"tag.3"', versions: [merged, ...pricing.versions] }));
    expect(context()).toMatchObject({ etag: '"tag.3"', versions: [merged, ...pricing.versions] });
  });

  it('follows a link to a pull request while the page is open', async () => {
    await render();
    expect(pullRequestsTab()).toHaveLength(0);
    await act(async () => navigate(`/pricings/acme/demo?tab=pull-requests&pr=${PR_ID}`));
    expect(pullRequestsTab()).toHaveLength(1);
    expect(pullRequestsTab()[0].props.selectedId).toBe(PR_ID);
    expect(mocks.getPricingBySlug).toHaveBeenCalledTimes(1);
  });
});
