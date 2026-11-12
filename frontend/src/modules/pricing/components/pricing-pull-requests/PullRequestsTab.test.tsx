import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingPullRequestsTab from '.';
import ForkProposal from '../fork-proposal-modal';
import FileDiffView from '../pricing-version-diff/file-diff-view';
import FileUpload from '../../../core/components/file-upload-input';
import { PullRequestApiError } from '../../api/pricingPullRequestsApi';
import type {
  ForkTarget,
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
  getForkTarget: vi.fn(),
  previewProposal: vi.fn(),
  createPullRequest: vi.fn(),
  getPricingBySlug: vi.fn(),
  openEditor: vi.fn(),
  versionHref: vi.fn(),
  openVersion: vi.fn(),
  alert: vi.fn(),
  user: { id: 'maintainer', username: 'maintainer' } as { id: string; username: string },
}));
vi.mock('../../api/pricingPullRequestsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/pricingPullRequestsApi')>()),
  usePricingPullRequestsApi: () => mocks,
}));
vi.mock('../../api/pricingsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/pricingsApi')>()),
  usePricingsApi: () => ({ getPricingBySlug: mocks.getPricingBySlug }),
}));
vi.mock('../../../auth/hooks/useAuth', () => ({
  useAuth: () => ({ authUser: { isAuthenticated: true, user: mocks.user } }),
}));
vi.mock('../../../core/utils/custom-alert', () => ({ default: mocks.alert }));
// The drop zone needs a browser: the tests hand the dialog a file through its `onSubmit`.
vi.mock('../../../core/components/file-upload-input', () => ({ default: () => null }));
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
const context = {
  versions: [],
  onMerged: () => {},
  onPricingChanged: () => false,
  openEditor: mocks.openEditor,
  versionHref: mocks.versionHref,
  openVersion: mocks.openVersion,
};
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

  it('compares the proposal with the base as SPHERE upgrades it, so the upgrade is not the author\'s change', async () => {
    const raw = "syntaxVersion: '2.1'\nsaasName: Demo\nversion: '2.0'\naddOns:\n  extra:\n    price: 5\nplans:\n  PRO:\n    price: 10\n";
    const upgraded = 'syntaxVersion: "3.1"\nsaasName: Demo\nversion: "2.0"\naddOns:\n  extra:\n    price: 5\n    subscriptionConstraints:\n      minQuantity: 1\nplans:\n  PRO:\n    price: 10\n';
    const proposed = upgraded.replace('price: 10', 'price: 12');
    mocks.getPullRequest.mockResolvedValue(detail({
      base: { versionId: 'v2', version: '2.0', yaml: raw, normalizedYaml: upgraded },
      proposed: { suggestedVersion: '2.1', yaml: proposed },
    }));
    await render(PR_ID);
    expect(text()).toContain('Version 2.0 is written in an older Pricing2Yaml syntax');
    expect(text()).toContain('PRO');
    expect(text()).not.toContain('syntaxVersion');
    expect(text()).not.toContain('subscriptionConstraints');
    expect(text()).not.toContain('extra');

    await act(async () => button('File').props.onClick());
    const file = view.root.findByType(FileDiffView);
    expect(file.props).toMatchObject({ before: upgraded, after: proposed });
    const marks = file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)));
    expect(marks.map(textOf)).toEqual(['~', '~']);
  });

  it('says nothing about the syntax when the base is already in the latest one', async () => {
    await render(PR_ID);
    expect(text()).not.toContain('older Pricing2Yaml syntax');
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

  it('links a merged pull request to the version it published, only when the server names it (CA-38)', async () => {
    mocks.versionHref.mockImplementation((id: string) => `/pricings/acme/demo?version=${id}`);
    const merged = (version: { versionId?: string; version?: string }) =>
      detail({ status: 'merged', state: { kind: 'merged' }, merged: { at: new Date().toISOString(), ...version } });
    mocks.getPullRequest.mockResolvedValue(merged({ versionId: 'v4', version: '2.1' }));
    await render(PR_ID);
    expect(text()).toContain('Merged as version 2.1');
    const link = view.root.findAllByType('a').find(item => textOf(item) === 'View version 2.1')!;
    expect(link.props.href).toBe('/pricings/acme/demo?version=v4');
    expect(link.props.className).toContain('cursor-pointer');
    expect(mocks.versionHref).toHaveBeenCalledWith('v4');

    // A modified click (a new tab) follows the link; a plain one stays in the app.
    const click = (event: Partial<MouseEvent>) => {
      const preventDefault = vi.fn();
      act(() => link.props.onClick({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...event, preventDefault }));
      return preventDefault;
    };
    expect(click({ ctrlKey: true })).not.toHaveBeenCalled();
    expect(mocks.openVersion).not.toHaveBeenCalled();
    expect(click({})).toHaveBeenCalled();
    expect(mocks.openVersion).toHaveBeenCalledWith('v4');

    // Who may not read the merged version is not told which one it is, nor linked to it.
    act(() => view.unmount());
    mocks.getPullRequest.mockResolvedValue(merged({}));
    await render(PR_ID);
    expect(text()).toContain('Merged');
    expect(text()).not.toContain('View version');
    expect(view.root.findAllByType('a')).toHaveLength(0);
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
            context={{ ...context, versions: [latest], etag: '"e.4"', onMerged }}
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
  it('lets the author edit an open proposal in the editor while it starts from the latest public version', async () => {
    mocks.user = { id: 'author', username: 'alice' };
    mocks.getPullRequest.mockResolvedValue(detail({
      permissions: { edit: true, editProposal: true, update: false, close: true, merge: false },
    }));
    await render(PR_ID);
    await act(async () => button('Edit proposal').props.onClick());
    expect(mocks.openEditor).toHaveBeenCalledWith({ id: 'v2', version: '2.0' }, { mode: 'code', pullRequestId: PR_ID });

    mocks.getPullRequest.mockResolvedValue(detail({
      permissions: { edit: true, editProposal: false, update: true, close: true, merge: false },
    }));
    await act(async () => {
      view.update(<PricingPullRequestsTab pricingId={PRICING} selectedId="6650f0c0c0c0c0c0c0c0c0bb" onSelect={onSelect} context={context} />);
    });
    expect(button('Edit proposal')).toBeUndefined();
  });

  describe('proposing changes', () => {
    const LATEST_YAML = 'saasName: Demo\nversion: "2.0"\nplans:\n  BASIC:\n    price: 0\n  PRO:\n    price: 10\n';
    const latestVersion: VersionData = {
      id: 'v2', version: '2.0', createdAt: '2026-02-01', yaml: '/static/pricings/acme/demo/2.0.yml', private: false,
      collection: null, analytics: null, forkedFrom: null,
    };
    const withVersions = { ...context, versions: [latestVersion] };
    const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 5)));
    const fetchMock = vi.fn();

    async function renderList(list: PullRequestList) {
      mocks.listPullRequests.mockResolvedValue(list);
      await act(async () => {
        view = create(<PricingPullRequestsTab pricingId={PRICING} selectedId={null} onSelect={onSelect} context={withVersions} />);
      });
    }

    async function upload(name: string, text: string) {
      await act(async () => button('Propose changes').props.onClick());
      await act(async () => button('Upload YAMLPropose a file as the next version of 2.0').props.onClick());
      await flush();
      await act(async () => view.root.findByType(FileUpload).props.onSubmit(new File([text], name)));
      await flush();
    }

    beforeEach(() => {
      fetchMock.mockImplementation(async () => new Response(LATEST_YAML));
      vi.stubGlobal('fetch', fetchMock);
      // The menu closes on outside clicks and Escape, listened for on the document.
      vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('disables "Propose changes" with the reason when there is no public version (CA-7)', async () => {
      await renderList(page([], { proposals: { canOpen: false, reason: 'NO_PUBLIC_VERSION', latest: null } }));
      const propose = button('Propose changes');
      expect(propose.props.disabled).toBe(true);
      expect(propose.props.className).toContain('disabled:cursor-default');
      expect(view.root.findByProps({ id: 'propose-block-reason' }).children.map(textOf).join('')).toBe(
        'This pricing has no public version to propose changes to.'
      );

      await act(async () => view.unmount());
      await renderList(page([], { proposals: { canOpen: false, reason: 'LIMIT_REACHED', latest: { id: 'v2', version: '2.0' } } }));
      expect(button('Propose changes').props.disabled).toBe(true);
      expect(text()).toContain('You cannot open more pull requests on this pricing for now.');
    });

    it('opens the latest public version in the editor to propose changes', async () => {
      await renderList(page([]));
      const propose = button('Propose changes');
      expect(propose.props.disabled).toBe(false);
      await act(async () => propose.props.onClick());
      await act(async () => button('Code editorEdit the YAML of version 2.0').props.onClick());
      expect(mocks.openEditor).toHaveBeenCalledWith({ id: 'v2', version: '2.0' }, { mode: 'code' });
      await act(async () => button('Propose changes').props.onClick());
      await act(async () => button('Visual editorEdit version 2.0 visually').props.onClick());
      expect(mocks.openEditor).toHaveBeenLastCalledWith({ id: 'v2', version: '2.0' }, { mode: 'visual' });
    });

    it('proposes an uploaded file on the latest public version, summarising it and warning about removals (CA-22)', async () => {
      const proposed = 'saasName: Demo\nversion: "2.1"\nplans:\n  PRO:\n    price: 12\n  TEAM:\n    price: 30\n';
      mocks.createPullRequest.mockResolvedValue({ ...detail({ id: 'new-pr', number: 8 }), warnings: [{ code: 'SYNTAX_UPGRADED' }] });
      await renderList(page([]));
      await upload('demo.yml', proposed);

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/static/pricings/acme/demo/2.0.yml', {});
      expect(text()).toContain('Changes against version 2.0, the latest public version');
      const warning = view.root.findByProps({ 'data-warning': 'removals' });
      expect(textOf(warning)).toContain('This proposal removes plans BASIC');
      expect(text()).toContain('+TEAM');
      expect(text()).toContain('~PRO');
      expect(text()).toContain('Prices change: PRO');

      expect(button('Open pull request').props.disabled).toBe(true);
      expect(text()).toContain('Give the pull request a title.');
      act(() => view.root.findByType('input').props.onChange({ target: { value: '  Raise PRO ' } }));
      await act(async () => button('Open pull request').props.onClick());
      expect(mocks.createPullRequest).toHaveBeenCalledWith({
        title: 'Raise PRO',
        source: { kind: 'text', pricingId: PRICING, baseVersionId: 'v2', proposedYaml: proposed },
      });
      expect(mocks.alert).toHaveBeenCalledWith(expect.stringContaining('Pull request #8 opened. Some of these pricings'), 'success');
      expect(onSelect).toHaveBeenCalledWith('new-pr');
      expect(view.root.findAllByType(FileUpload)).toHaveLength(0);
    });

    it('says there is nothing to propose when the file is the latest public version (CA-15)', async () => {
      await renderList(page([]));
      await upload('same.yml', LATEST_YAML.replace('saasName: Demo', 'saasName: Renamed'));
      expect(text()).toContain('Nothing to propose: it is the same as version 2.0.');
      act(() => view.root.findByType('input').props.onChange({ target: { value: 'Same' } }));
      expect(button('Open pull request').props.disabled).toBe(true);
      expect(text()).toContain('Nothing to propose: the file is the same as version 2.0.');
    });

    it('refuses a file in the latest syntax that the pricing parser refuses, and explains refusals', async () => {
      await renderList(page([]));
      await upload('broken.yml', 'saasName: Demo\nsyntaxVersion: "3.1"\nversion: "2.1"\n');
      expect(view.root.findByProps({ role: 'alert' }).children.map(textOf).join('')).toContain('The file is not a valid pricing');
      expect(view.root.findAllByType(FileUpload)).toHaveLength(1);

      mocks.createPullRequest.mockRejectedValue(
        new PullRequestApiError(409, { error: 'x', code: 'BASE_NOT_LATEST', latest: { id: 'v3', version: '3.0' } })
      );
      await act(async () =>
        view.root.findByType(FileUpload).props.onSubmit(new File(['saasName: Demo\nplans:\n  PRO:\n    price: 12\n'], 'old.yml'))
      );
      await flush();
      act(() => view.root.findByType('input').props.onChange({ target: { value: 'Old syntax' } }));
      await act(async () => button('Open pull request').props.onClick());
      expect(view.root.findByProps({ role: 'alert' }).children.map(textOf).join('')).toBe(
        'A newer public version (3.0) was published. Proposals start from the latest public version. ' +
          'The proposal now starts from version 3.0: review its changes and open it again.'
      );
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('after a newer public version was published, compares the file with it and proposes it there', async () => {
      const newer: VersionData = { ...latestVersion, id: 'v3', version: '3.0', yaml: '/static/pricings/acme/demo/3.0.yml' };
      const NEWER_YAML = LATEST_YAML.replace('version: "2.0"', 'version: "3.0"').replace('price: 10', 'price: 11');
      fetchMock.mockImplementation(async (url: string) => new Response(url.endsWith('/3.0.yml') ? NEWER_YAML : LATEST_YAML));
      mocks.listPullRequests.mockResolvedValue(page([]));
      await act(async () => {
        view = create(
          <PricingPullRequestsTab pricingId={PRICING} selectedId={null} onSelect={onSelect} context={{ ...withVersions, versions: [newer, latestVersion] }} />
        );
      });
      const proposed = 'saasName: Demo\nversion: "2.1"\nplans:\n  BASIC:\n    price: 0\n  PRO:\n    price: 12\n';
      await upload('demo.yml', proposed);
      act(() => view.root.findByType('input').props.onChange({ target: { value: 'Raise PRO' } }));
      mocks.createPullRequest.mockRejectedValueOnce(
        new PullRequestApiError(409, { error: 'x', code: 'BASE_NOT_LATEST', latest: { id: 'v3', version: '3.0' } })
      );
      await act(async () => button('Open pull request').props.onClick());
      await flush();

      expect(text()).toContain('The pull request is based on version 3.0, the latest public version.');
      expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/static/pricings/acme/demo/3.0.yml', {});
      expect(text()).toContain('Changes against version 3.0');
      expect(button('Open pull request').props.disabled).toBe(false);

      mocks.createPullRequest.mockResolvedValue({ ...detail({ id: 'new-pr', number: 9 }), warnings: [] });
      await act(async () => button('Open pull request').props.onClick());
      expect(mocks.createPullRequest).toHaveBeenLastCalledWith({
        title: 'Raise PRO',
        source: { kind: 'text', pricingId: PRICING, baseVersionId: 'v3', proposedYaml: proposed },
      });
      expect(onSelect).toHaveBeenCalledWith('new-pr');
    });

    it('gives every enabled button of the menu and the upload dialog a pointer cursor (CA-37)', async () => {
      await renderList(page([]));
      await upload('demo.yml', 'saasName: Demo\nplans:\n  PRO:\n    price: 12\n');
      const enabled = buttons().filter(item => !item.props.disabled);
      expect(enabled.length).toBeGreaterThan(5);
      enabled.forEach(item => expect(item.props.className).toContain('cursor-pointer'));
    });
  });

  describe('proposing a fork to the pricing it came from', () => {
    const FORK = '6650f0c0c0c0c0c0c0c0c0f1';
    const forkedFrom: NonNullable<VersionData['forkedFrom']> = {
      pricingId: PRICING, organizationId: 'acme', organizationName: 'acme', organizationDisplayName: 'Acme',
      collectionSlug: 'main', slug: 'demo', name: 'Demo', version: '1.0',
    };
    const parent = { pricingId: PRICING, name: 'Demo', slug: 'demo', organizationId: 'acme' };
    const forkPreview: PullRequestPreview = {
      base: { id: 'f1', version: '1.0' },
      target: { id: 'v2', version: '2.0' },
      outcome: 'merged',
      conflicts: [],
      resultYaml: PROPOSED_YAML,
      regenerated: true,
      validation: { ok: true },
      warnings: [{ code: 'FORMAT_REGENERATED' }, { code: 'PREVIOUSLY_MERGED', number: 3 }],
      previewToken: 'fork-token',
      suggestedVersion: '2.1',
      existingPullRequest: { id: PR_ID, number: 7, proposalRevision: 2 },
    };
    const onProposed = vi.fn();
    const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 5)));

    async function renderFork(target: ForkTarget | Error, props: { forkedFrom?: typeof forkedFrom | null; canCreate?: boolean } = {}) {
      if (target instanceof Error) mocks.getForkTarget.mockRejectedValue(target);
      else mocks.getForkTarget.mockResolvedValue(target);
      await act(async () => {
        view = create(
          <ForkProposal
            forkPricingId={FORK}
            forkedFrom={props.forkedFrom === undefined ? forkedFrom : props.forkedFrom}
            canCreate={props.canCreate ?? true}
            onProposed={onProposed}
          />
        );
      });
    }

    it('offers "Propose changes to <parent>" only on a fork, to who may publish its versions (CA-10, CA-18)', async () => {
      await renderFork({ canPropose: true, parent });
      expect(mocks.getForkTarget).toHaveBeenCalledWith(FORK);
      expect(button('Propose changes to Demo').props.disabled).toBe(false);
      expect(button('Propose changes to Demo').props.className).toContain('cursor-pointer');

      for (const props of [{ forkedFrom: null }, { canCreate: false }]) {
        await act(async () => view.unmount());
        mocks.getForkTarget.mockClear();
        await renderFork({ canPropose: true, parent }, props);
        expect(view.toJSON()).toBeNull();
        expect(mocks.getForkTarget).not.toHaveBeenCalled();
      }

      // The page's permissions can be behind the server's: a refusal hides it too.
      await act(async () => view.unmount());
      await renderFork(new PullRequestApiError(403, { error: 'Forbidden', code: 'FORBIDDEN' }));
      expect(view.toJSON()).toBeNull();
    });

    it('shows nothing when no readable version of the fork names a parent (CA-71)', async () => {
      await renderFork({ canPropose: false, reason: 'NOT_A_FORK' });
      expect(view.toJSON()).toBeNull();
    });

    it('disables the action with a neutral reason when the parent is gone or unreadable (CA-17)', async () => {
      await renderFork({ canPropose: false, reason: 'PARENT_UNAVAILABLE' });
      expect(button('Propose changes to Demo').props.disabled).toBe(true);
      expect(view.root.findByProps({ id: 'fork-proposal-reason' }).children.map(textOf).join('')).toBe(
        'The pricing this fork comes from is not available.'
      );

      await act(async () => view.unmount());
      await renderFork({ canPropose: false, reason: 'PULL_REQUEST_EXISTS', parent, openPullRequest: { number: 4 } });
      expect(button('Propose changes to Demo').props.disabled).toBe(true);
      expect(text()).toContain('Pull request #4 is already open');

      await act(async () => view.unmount());
      await renderFork({ canPropose: false, reason: 'NO_PUBLIC_VERSION', parent });
      expect(button('Propose changes to Demo').props.disabled).toBe(true);
      expect(text()).toContain('This pricing has no public version to propose changes to.');
    });

    it('replaces the author\'s open pull request, showing the notices of the merge (CA-89, CA-97)', async () => {
      mocks.previewProposal.mockResolvedValue(forkPreview);
      mocks.getPullRequest.mockResolvedValue(detail({ title: 'Earlier title', description: 'Earlier description' }));
      mocks.getPricingBySlug.mockResolvedValue({ pricingId: PRICING, versions: [{ id: 'v2', yaml: '/static/pricings/acme/demo/2.0.yml' }] });
      const fetchMock = vi.fn(async () => new Response(BASE_YAML));
      vi.stubGlobal('fetch', fetchMock);
      const created = { ...detail({ number: 7 }), warnings: [], updated: true as const };
      mocks.createPullRequest.mockResolvedValue(created);

      await renderFork({ canPropose: true, parent, openPullRequest: { id: PR_ID, number: 7, proposalRevision: 2 } });
      await act(async () => button('Update pull request #7').props.onClick());
      await flush();
      expect(mocks.previewProposal).toHaveBeenCalledWith({ kind: 'fork', forkPricingId: FORK }, {});
      expect(mocks.getPullRequest).toHaveBeenCalledWith(PR_ID);
      expect(text()).toContain('Replaces the current proposal of #7.');
      const notices = view.root.findAll(node => typeof node.props['data-warning'] === 'string').map(node => node.props['data-warning']);
      expect(notices).toEqual(['FORMAT_REGENERATED', 'PREVIOUSLY_MERGED']);
      expect(text()).toContain('Pull request #3 from this fork was merged before.');
      expect(text()).toContain('comments and the original layout are not kept');
      expect(view.root.findByType('input').props.value).toBe('Earlier title');

      // Compare reads the parent's latest public version, which the fork's page has not loaded.
      await act(async () => button('Compare').props.onClick());
      await flush();
      expect(mocks.getPricingBySlug).toHaveBeenCalledWith('demo', 'acme', 'main');
      expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: BASE_YAML, after: PROPOSED_YAML });

      // The dialog's own button, after the one on the page that opened it.
      const submit = buttons().filter(item => textOf(item).trim() === 'Update pull request #7');
      expect(submit).toHaveLength(2);
      await act(async () => submit[1].props.onClick());
      expect(mocks.createPullRequest).toHaveBeenCalledWith({
        title: 'Earlier title',
        description: 'Earlier description',
        source: { kind: 'fork', forkPricingId: FORK },
        resolutions: {},
        previewToken: 'fork-token',
      });
      expect(mocks.alert).toHaveBeenCalledWith('Pull request #7 updated on Demo.', 'success');
      expect(onProposed).toHaveBeenCalledWith(created, { organizationId: 'acme', slug: 'demo', collectionSlug: 'main' });
      vi.unstubAllGlobals();
    });

    it('says when the fork has nothing the parent lacks (CA-15)', async () => {
      mocks.previewProposal.mockResolvedValue({ ...forkPreview, outcome: 'no-changes', warnings: [], existingPullRequest: undefined });
      await renderFork({ canPropose: true, parent });
      await act(async () => button('Propose changes to Demo').props.onClick());
      await flush();
      act(() => view.root.findByType('input').props.onChange({ target: { value: 'Sync' } }));
      expect(button('Open pull request').props.disabled).toBe(true);
      expect(text()).toContain('Nothing to propose: version 2.0 of Demo already has everything this fork changes.');
    });
  });
});
