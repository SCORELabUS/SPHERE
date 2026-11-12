import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingPullRequestsTab from '.';
import FileDiffView from '../pricing-version-diff/file-diff-view';
import { PullRequestApiError } from '../../api/pricingPullRequestsApi';
import type {
  PullRequestDetail,
  PullRequestList,
  PullRequestPreview,
  PullRequestSummary,
} from '../../types/pull-requests';
import type { VersionData } from '../../types/card';

const mocks = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
  closePullRequest: vi.fn(),
  previewPullRequestMerge: vi.fn(),
  mergePullRequest: vi.fn(),
  user: { id: 'maintainer', username: 'maintainer' } as { id: string; username: string },
}));
vi.mock('../../api/pricingPullRequestsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/pricingPullRequestsApi')>()),
  usePricingPullRequestsApi: () => mocks,
}));
vi.mock('../../../auth/hooks/useAuth', () => ({
  useAuth: () => ({ authUser: { isAuthenticated: true, user: mocks.user } }),
}));
// Plain elements instead of animations, so a closed dialog leaves at once.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const cache = new Map<string, unknown>();
  const motion = new Proxy({}, {
    get: (_, tag: string) => {
      if (!cache.has(tag)) {
        cache.set(tag, ({ initial, animate, exit, transition, whileTap, layoutId, ...rest }: Record<string, unknown>) => {
          void initial; void animate; void exit; void transition; void whileTap; void layoutId;
          return React.createElement(tag, rest);
        });
      }
      return cache.get(tag);
    },
  });
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});

const PRICING = '6650f0c0c0c0c0c0c0c0c001';
const context = { versions: [], onMerged: () => {}, onPricingChanged: () => false };
const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';
const MARKUP = '<img src=x onerror="alert(1)">';
const BASE_YAML = 'saasName: Demo\nversion: "2.0"\nplans:\n  PRO:\n    price: 10\n';
const PROPOSED_YAML = 'saasName: Demo fork\nversion: "2.1"\nplans:\n  PRO:\n    price: 12\n';

const summary = (overrides: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  id: PR_ID,
  pricingId: PRICING,
  number: 7,
  title: 'Raise PRO',
  status: 'open',
  author: { id: 'author', username: 'alice' },
  base: { versionId: 'v2', version: '2.0' },
  proposed: { suggestedVersion: '2.1' },
  proposalRevision: 1,
  state: { kind: 'behind', conflicts: 2 },
  createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const page = (items: PullRequestSummary[], overrides: Partial<PullRequestList> = {}): PullRequestList => ({
  items,
  total: items.length,
  counts: { open: 3, merged: 4, closed: 5 },
  proposals: { canOpen: true, reason: null, latest: { id: 'v2', version: '2.0' } },
  viewer: { isMaintainer: true },
  ...overrides,
});

const detail = (overrides: Partial<PullRequestDetail> = {}): PullRequestDetail => {
  const { base, proposed, ...rest } = summary();
  return {
    ...rest,
    description: 'First line\nSecond line',
    base: { ...base, yaml: BASE_YAML },
    proposed: { ...proposed, yaml: PROPOSED_YAML },
    permissions: { edit: false, editProposal: false, update: false, close: true, merge: true },
    ...overrides,
  };
};

/** Every text the tree renders, in order. */
function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

describe('Pull requests tab', () => {
  let view: ReactTestRenderer;
  const onSelect = vi.fn();
  const text = () => textOf(view.root);
  const buttons = () => view.root.findAllByType('button');
  const button = (label: string) => buttons().find(item => textOf(item).trim() === label)!;

  async function render(selectedId: string | null = null) {
    await act(async () => {
      view = create(<PricingPullRequestsTab pricingId={PRICING} selectedId={selectedId} onSelect={onSelect} context={context} />);
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user = { id: 'maintainer', username: 'maintainer' };
    mocks.listPullRequests.mockResolvedValue(page([summary(), summary({ id: 'other', number: 6, author: null, state: { kind: 'up-to-date' } })]));
    mocks.getPullRequest.mockResolvedValue(detail());
  });
  afterEach(() => act(() => view?.unmount()));

  it('lists each pull request with its number, title, author, base, age and state', async () => {
    await render();
    expect(mocks.listPullRequests).toHaveBeenCalledWith(PRICING, { status: 'open', page: 1 });
    const rows = view.root.findAllByType('li').map(textOf);
    expect(rows[0]).toContain('#7');
    expect(rows[0]).toContain('Raise PRO');
    expect(rows[0]).toContain('alice · based on 2.0 · opened 3 days ago');
    expect(rows[0]).toContain('Behind · 2 conflicts');
    expect(rows[1]).toContain('Deleted user');
    expect(rows[1]).toContain('Up to date');
  });

  it('filters by status with the counts the API gives, and pages', async () => {
    mocks.listPullRequests.mockResolvedValue(page([summary()], { total: 45 }));
    await render();
    expect(textOf(button('Open3'))).toBe('Open3');
    expect(textOf(button('All12'))).toBe('All12');

    await act(async () => button('2').props.onClick());
    expect(mocks.listPullRequests).toHaveBeenLastCalledWith(PRICING, { status: 'open', page: 2 });
    await act(async () => button('Merged4').props.onClick());
    expect(mocks.listPullRequests).toHaveBeenLastCalledWith(PRICING, { status: 'merged', page: 1 });
    expect(button('Merged4').props['aria-pressed']).toBe(true);
    await act(async () => button('All12').props.onClick());
    expect(mocks.listPullRequests).toHaveBeenLastCalledWith(PRICING, { status: undefined, page: 1 });
  });

  it('says when there is nothing to show and when the list cannot load', async () => {
    mocks.listPullRequests.mockResolvedValueOnce(page([], { viewer: { isMaintainer: false } }));
    await render();
    expect(text()).toContain('No open pull requests.');
    expect(text()).toContain('You see the pull requests you opened.');

    mocks.listPullRequests.mockRejectedValueOnce(new PullRequestApiError(401, { error: 'x', code: 'WEB_SESSION_REQUIRED' }));
    await act(async () => button('Closed5').props.onClick());
    expect(view.root.findByProps({ role: 'alert' }).children.map(textOf).join('')).toBe(
      'Sign in to SPHERE to work with pull requests.'
    );
  });

  it('opens a pull request from its row and goes back to the list (CA-59)', async () => {
    await render();
    await act(async () => view.root.findAllByType('li')[0].findByType('button').props.onClick());
    expect(onSelect).toHaveBeenCalledWith(PR_ID);

    await act(async () => {
      view.update(<PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={context} />);
    });
    expect(mocks.getPullRequest).toHaveBeenCalledWith(PR_ID);
    expect(text()).toContain('#7Raise PRO');
    await act(async () => button('All pull requests').props.onClick());
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('keeps the filter and page when coming back from a pull request', async () => {
    mocks.listPullRequests.mockResolvedValue(page([summary()], { total: 45 }));
    await render();
    await act(async () => button('Merged4').props.onClick());
    await act(async () => button('2').props.onClick());
    await act(async () => {
      view.update(<PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={context} />);
    });
    await act(async () => {
      view.update(<PricingPullRequestsTab pricingId={PRICING} selectedId={null} onSelect={onSelect} context={context} />);
    });
    expect(mocks.listPullRequests).toHaveBeenLastCalledWith(PRICING, { status: 'merged', page: 2 });
  });

  it('shows the changes against the base version, leaving out the name SPHERE sets on merging', async () => {
    await render(PR_ID);
    expect(text()).toContain('Proposal compared with version 2.0');
    expect(text()).toContain('PRO');
    expect(text()).not.toContain('saasName');
    expect(text()).not.toContain('Demo fork');

    await act(async () => button('File').props.onClick());
    const file = view.root.findByType(FileDiffView);
    expect(file.props).toMatchObject({ before: BASE_YAML, after: PROPOSED_YAML, beforeLabel: 'Version 2.0', afterLabel: 'Proposal' });
    // Changed lines carry a text mark on each side, not only a colour.
    const marks = file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)));
    expect(marks.map(textOf).sort()).toEqual(['~', '~', '~', '~', '~', '~']);
  });

  it('marks added and removed lines with + and − in the file view', async () => {
    mocks.getPullRequest.mockResolvedValue(detail({
      base: { versionId: 'v2', version: '2.0', yaml: 'saasName: Demo\nold: 1\nkeep: 1\n' },
      proposed: { suggestedVersion: '2.1', yaml: 'saasName: Demo\nkeep: 1\nnew: 1\n' },
    }));
    await render(PR_ID);
    await act(async () => button('File').props.onClick());
    const file = view.root.findByType(FileDiffView);
    const marks = file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)));
    expect(marks.map(textOf)).toEqual(['−', '+']);
  });

  it('shows the suggested version and the fork it came from', async () => {
    mocks.getPullRequest.mockResolvedValue(detail({
      origin: {
        pricingId: 'f', name: 'Demo fork', slug: 'demo-fork', version: '1.3', editedAfterProposal: true,
        organization: { id: 'o', name: 'acme', displayName: 'Acme' },
      },
    }));
    await render(PR_ID);
    expect(text()).toContain('Suggested version2.1');
    expect(text()).toContain('Acme / Demo fork (version 1.3)edited after it was proposed');
  });

  it('renders titles, descriptions and reasons as plain text (CA-80)', async () => {
    mocks.listPullRequests.mockResolvedValue(page([summary({ title: MARKUP })]));
    mocks.getPullRequest.mockResolvedValue(detail({
      title: MARKUP,
      description: `${MARKUP}\n<a href="javascript:alert(1)">x</a>`,
      status: 'closed',
      state: { kind: 'closed' },
      closed: { kind: 'rejected', at: new Date().toISOString(), reason: MARKUP },
      proposed: { suggestedVersion: '2.1', yaml: `${PROPOSED_YAML}url: javascript:alert(1)\n` },
      permissions: { edit: false, editProposal: false, update: false, close: false, merge: false },
    }));
    await render();
    expect(textOf(view.root.findByType('li'))).toContain(MARKUP);

    await act(async () => {
      view.update(<PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={context} />);
    });
    await act(async () => button('File').props.onClick());
    const description = view.root.findAll(node => node.type === 'p' && textOf(node).includes('javascript:alert(1)">x'));
    expect(description).toHaveLength(1);
    expect(description[0].props.className).toContain('whitespace-pre-wrap');
    expect(text().split(MARKUP)).toHaveLength(4); // title, description and reason
    expect(text()).toContain('Rejected by a maintainer');
    expect(view.root.findAll(node => node.type === 'img' || node.type === 'a')).toHaveLength(0);
    expect(view.root.findAll(node => 'dangerouslySetInnerHTML' in node.props || 'href' in node.props)).toHaveLength(0);
  });

  it('gives every enabled button a pointer cursor (CA-37)', async () => {
    mocks.listPullRequests.mockResolvedValue(page([summary()], { total: 45 }));
    await render();
    const enabled = () => buttons().filter(item => !item.props.disabled);
    expect(enabled().length).toBeGreaterThan(4);
    enabled().forEach(item => expect(item.props.className).toContain('cursor-pointer'));

    await act(async () => {
      view.update(<PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={context} />);
    });
    await act(async () => button('Close').props.onClick());
    expect(enabled().length).toBeGreaterThan(4);
    enabled().forEach(item => expect(item.props.className).toContain('cursor-pointer'));
  });

  it('lets a maintainer close a pull request with a reason', async () => {
    const closedAt = new Date().toISOString();
    mocks.closePullRequest.mockResolvedValue(detail({
      status: 'closed',
      state: { kind: 'closed' },
      closed: { kind: 'rejected', at: closedAt, reason: 'Out of scope' },
      permissions: { edit: false, editProposal: false, update: false, close: false, merge: false },
    }));
    await render(PR_ID);
    expect(button('Withdraw')).toBeUndefined();
    await act(async () => button('Close').props.onClick());
    expect(text()).toContain('Close pull request #7');
    act(() => view.root.findByType('textarea').props.onChange({ target: { value: '  Out of scope ' } }));
    await act(async () => button('Close pull request').props.onClick());

    expect(mocks.closePullRequest).toHaveBeenCalledWith(PR_ID, 'Out of scope');
    expect(view.root.findAllByType('textarea')).toHaveLength(0);
    expect(text()).toContain('Closed');
    expect(text()).toContain('Out of scope');
    expect(button('Close')).toBeUndefined();
  });

  it('lets the author withdraw, and keeps the dialog open with the reason it failed', async () => {
    mocks.user = { id: 'author', username: 'alice' };
    mocks.closePullRequest.mockRejectedValue(new PullRequestApiError(409, { error: 'merging', code: 'PULL_REQUEST_MERGING' }));
    await render(PR_ID);
    expect(button('Close')).toBeUndefined();
    await act(async () => button('Withdraw').props.onClick());
    await act(async () => button('Withdraw pull request').props.onClick());
    expect(mocks.closePullRequest).toHaveBeenCalledWith(PR_ID, undefined);
    expect(view.root.findByProps({ role: 'alert' }).children.map(textOf).join('')).toBe(
      'This pull request is being merged right now. Try again in a moment.'
    );
    expect(button('Withdraw pull request').props.disabled).toBe(false);
  });

  it('offers no closing without permission, and says when the pull request is not available', async () => {
    mocks.getPullRequest.mockResolvedValueOnce(detail({
      permissions: { edit: false, editProposal: false, update: false, close: false, merge: false },
    }));
    await render(PR_ID);
    expect(button('Close')).toBeUndefined();
    expect(button('Withdraw')).toBeUndefined();

    mocks.getPullRequest.mockRejectedValueOnce(new PullRequestApiError(404, { error: 'Pull request not found' }));
    await act(async () => {
      view.update(<PricingPullRequestsTab pricingId={PRICING} selectedId="6650f0c0c0c0c0c0c0c0c0bb" onSelect={onSelect} context={context} />);
    });
    expect(text()).toContain('This pull request is not available.');
  });

  describe('merging and updating from the detail', () => {
    const LATEST_YAML = 'saasName: Demo\nversion: "3.0"\nplans:\n  PRO:\n    price: 11\n';
    const latest: VersionData = {
      id: 'v3', version: '3.0', createdAt: '2026-03-01', yaml: '/static/pricings/acme/demo/3.0.yml', private: false,
      collection: null, analytics: null, forkedFrom: null,
    };
    const mergePreview: PullRequestPreview = {
      base: { id: 'v2', version: '2.0' },
      target: { id: 'v3', version: '3.0', private: false },
      outcome: 'merged',
      conflicts: [],
      resultYaml: PROPOSED_YAML,
      regenerated: false,
      validation: { ok: true },
      warnings: [],
      previewToken: 'token-1',
      suggestedVersion: '2.1',
      versionTaken: false,
      defaults: { private: false },
    };
    const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 5)));
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockImplementation(async () => new Response(LATEST_YAML));
      vi.stubGlobal('fetch', fetchMock);
      mocks.previewPullRequestMerge.mockResolvedValue(mergePreview);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('lets a maintainer merge with the page ETag, reading the version it follows from the page', async () => {
      const onMerged = vi.fn();
      const result = {
        pullRequest: detail({
          status: 'merged',
          state: { kind: 'merged' },
          merged: { at: new Date().toISOString(), versionId: 'v4', version: '2.1' },
          permissions: { edit: false, editProposal: false, update: false, close: false, merge: false },
        }),
        version: { id: 'v4', version: '2.1', private: false },
        etag: '"e.5"',
      };
      mocks.mergePullRequest.mockResolvedValue(result);
      await act(async () => {
        view = create(
          <PricingPullRequestsTab
            pricingId={PRICING}
            selectedId={PR_ID}
            onSelect={onSelect}
            context={{ versions: [latest], etag: '"e.4"', onMerged, onPricingChanged: () => false }}
          />
        );
      });
      expect(button('Update to latest')).toBeUndefined();
      await act(async () => button('Merge…').props.onClick());
      await flush();
      expect(mocks.previewPullRequestMerge).toHaveBeenCalledWith(PR_ID, 'merge', {});

      await act(async () => button('Compare').props.onClick());
      await flush();
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/static/pricings/acme/demo/3.0.yml', {});
      expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: LATEST_YAML, after: PROPOSED_YAML });

      await act(async () => button('Merge pull request').props.onClick());
      expect(mocks.mergePullRequest).toHaveBeenCalledWith(
        PR_ID,
        { resolutions: {}, previewToken: 'token-1', version: '2.1', private: false },
        '"e.4"'
      );
      expect(onMerged).toHaveBeenCalledWith(result);
      expect(text()).toContain('Merged as 2.1');
      expect(button('Merge pull request')).toBeUndefined();
      expect(button('Merge…')).toBeUndefined();
    });

    it('lets the author bring a pull request behind the latest version up to it', async () => {
      mocks.user = { id: 'author', username: 'alice' };
      mocks.getPullRequest.mockResolvedValue(detail({
        permissions: { edit: true, editProposal: false, update: true, close: true, merge: false },
      }));
      await render(PR_ID);
      expect(button('Merge…')).toBeUndefined();
      await act(async () => button('Update to latest').props.onClick());
      await flush();
      expect(mocks.previewPullRequestMerge).toHaveBeenCalledWith(PR_ID, 'update', {});
      expect(button('Update pull request').props.disabled).toBe(false);
      await act(async () => button('Cancel').props.onClick());
      expect(text()).toContain('Proposal compared with version 2.0');
    });
  });
});
