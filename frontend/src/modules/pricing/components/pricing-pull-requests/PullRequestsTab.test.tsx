import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingPullRequestsTab from '.';
import ForkProposal from '../fork-proposal-modal';
import FileDiffView from '../pricing-version-diff/file-diff-view';
import FileUpload from '../../../core/components/file-upload-input';
import { PullRequestApiError } from '../../api/pricingPullRequestsApi';
import type {
  ForkTarget,
  MergeConflict,
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
  versionHref: vi.fn(),
  openVersion: vi.fn(),
  alert: vi.fn(),
  confirm: vi.fn(),
  editor: { createDecorationsCollection: () => ({ clear: () => {} }), revealLineInCenter: () => {}, setPosition: () => {}, focus: () => {} },
  user: { id: 'maintainer', username: 'maintainer' } as { id: string; username: string },
}));
vi.mock('../../../core/utils/custom-confirm', () => ({ default: mocks.confirm }));
// The test renderer has no portals: the expanded resolver renders where it is, as the window would show it.
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (node: unknown) => node,
}));
// Monaco needs a browser: a text area stands in, read-only or not as the editor is.
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  function MonacoEditor({
    value,
    onChange,
    onMount,
    options,
  }: {
    value: string;
    onChange?: (value: string) => void;
    onMount: (editor: unknown) => void;
    options?: { readOnly?: boolean };
  }) {
    React.useEffect(() => onMount(mocks.editor), [onMount]);
    return React.createElement('textarea', {
      'data-editor': 'yaml',
      value,
      readOnly: options?.readOnly ?? false,
      onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
    });
  }
  return { default: MonacoEditor };
});
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
  const button = (label: string, root: ReactTestInstance = view.root) =>
    root.findAllByType('button').find(item => textOf(item).trim() === label)!;

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
    expect(text()).toContain('Version 2.0 and the proposal are written in different Pricing2Yaml syntaxes.');
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

  it('keeps the proposal as written, comparing it upgraded when it is in an older syntax than the base', async () => {
    const proposedRaw = "syntaxVersion: '2.1'\nsaasName: Demo\nversion: '2.1'\nplans:\n  PRO:\n    price: 12\n";
    const proposedUpgraded = 'syntaxVersion: "3.1"\nsaasName: Demo\nversion: "2.1"\nplans:\n  PRO:\n    price: 12\n';
    const base = 'syntaxVersion: "3.1"\nsaasName: Demo\nversion: "2.0"\nplans:\n  PRO:\n    price: 10\n';
    mocks.getPullRequest.mockResolvedValue(detail({
      base: { versionId: 'v2', version: '2.0', yaml: base },
      proposed: { suggestedVersion: '2.1', yaml: proposedRaw, normalizedYaml: proposedUpgraded },
    }));
    await render(PR_ID);
    expect(text().match(/different Pricing2Yaml syntaxes/g)).toHaveLength(1);
    await act(async () => button('File').props.onClick());
    const file = view.root.findByType(FileDiffView);
    expect(file.props).toMatchObject({ before: base, after: proposedUpgraded });
    const marks = file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)));
    expect(marks.map(textOf)).toEqual(['~', '~', '~', '~']);
  });

  it('does not count values the latest syntax reads as absent as changes, written or not', async () => {
    mocks.getPullRequest.mockResolvedValue(detail({
      base: { versionId: 'v2', version: '2.0', yaml: 'saasName: Demo\nvariables: {}\nbilling:\n  monthly: 1\nplans:\n  PRO:\n    price: 10\n' },
      proposed: { suggestedVersion: '2.1', yaml: 'saasName: Demo\ntags: []\nplans:\n  PRO:\n    price: 12\n' },
    }));
    await render(PR_ID);
    expect(text()).toContain('PRO');
    expect(text()).not.toMatch(/variables|billing|tags/);
  });

  it('says nothing about the syntax when the base is already in the latest one', async () => {
    await render(PR_ID);
    expect(text()).not.toContain('Pricing2Yaml syntax');
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

  it('does not show the quotes SPHERE writes around the same name as a change in the file view', async () => {
    mocks.getPullRequest.mockResolvedValue(detail({
      base: { versionId: 'v2', version: '2.0', yaml: 'saasName: Demo\nplans:\n  PRO:\n    price: 10\n' },
      proposed: { suggestedVersion: '2.1', yaml: 'saasName: "Demo"\nplans:\n  PRO:\n    price: 12\n' },
    }));
    await render(PR_ID);
    await act(async () => button('File').props.onClick());
    const file = view.root.findByType(FileDiffView);
    expect(file.props.after).toBe('saasName: Demo\nplans:\n  PRO:\n    price: 12\n');
    const marks = file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)));
    expect(marks.map(textOf)).toEqual(['~', '~']);
  });

  it('shows two versions formatted differently in one format in the file view, so the quotes are not changes', async () => {
    mocks.getPullRequest.mockResolvedValue(detail({
      base: { versionId: 'v2', version: '2.0', yaml: "saasName: Demo\nsyntaxVersion: '3.1'\nplans:\n  PRO:\n    unit: user/month\n    price: 10\n" },
      proposed: { suggestedVersion: '2.1', yaml: 'saasName: "Demo"\nsyntaxVersion: "3.1"\nplans:\n  PRO:\n    unit: "user/month"\n    price: 12\n' },
    }));
    await render(PR_ID);
    expect(text()).not.toContain('formatted differently');
    await act(async () => button('File').props.onClick());
    const file = view.root.findByType(FileDiffView);
    expect(file.props).toMatchObject({
      before: "saasName: Demo\nsyntaxVersion: '3.1'\nplans:\n  PRO:\n    unit: user/month\n    price: 10\n",
      after: "saasName: Demo\nsyntaxVersion: '3.1'\nplans:\n  PRO:\n    unit: user/month\n    price: 12\n",
      beforeLabel: 'Version 2.0',
      afterLabel: 'Proposal',
    });
    const marks = file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)));
    expect(marks.map(textOf)).toEqual(['~', '~']);
    expect(text()).toContain('Version 2.0 and the proposal are formatted differently (quotes, line breaks or comments).');
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

    // Without the version it was merged on, the changes are the proposal's, saying the result can differ.
    expect(text()).toContain('Proposal compared with version 2.0');
    expect(text()).toContain('What was published can differ where conflicts were resolved when merging.');
    expect(button('Published')).toBeUndefined();
    expect(text()).not.toContain('Suggested version');

    // Who may not read the merged version is not told which one it is, nor linked to it.
    act(() => view.unmount());
    mocks.getPullRequest.mockResolvedValue(merged({}));
    await render(PR_ID);
    expect(text()).toContain('Merged');
    expect(text()).not.toContain('View version');
    expect(view.root.findAllByType('a')).toHaveLength(0);
  });

  it('does not show a pull request of another pricing under this one', async () => {
    mocks.getPullRequest.mockResolvedValue(detail({ pricingId: '6650f0c0c0c0c0c0c0c0c0ff' }));
    await render(PR_ID);
    expect(view.root.findByProps({ role: 'alert' }).children.map(textOf).join('')).toBe('This pull request is not available.');
    expect(button('Resolve conflicts')).toBeUndefined();
    expect(button('Merge pull request')).toBeUndefined();
    expect(text()).not.toContain('Raise PRO');
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
      // The resolver's full window keeps the page behind from scrolling: a body stands in for the browser's.
      vi.stubGlobal('document', { body: { style: { overflow: '' } } });
      mocks.previewPullRequestMerge.mockResolvedValue(mergePreview);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('puts the merge box of an open pull request right below its header: where it stands and the one thing to do next', async () => {
      const box = () => view.root.find(node => node.type === 'section' && node.props['aria-label'] === 'Merge');
      // Conflicts already known: resolving them comes first, and the changes stay in view.
      await render(PR_ID);
      // Above the description and the changes, however long they are.
      const sections = view.root.findAll(node => node.type === 'section');
      const description = sections.findIndex(node => textOf(node).startsWith('Description'));
      expect(sections.indexOf(box())).toBeLessThan(description);
      expect(sections.findIndex(node => textOf(node).startsWith('Changes'))).toBeGreaterThan(description);
      expect(textOf(box())).toContain('2 conflicts with the latest version');
      expect(textOf(box())).toContain('choose a side for each before merging');
      expect(button('Resolve conflicts', box()).props.className).toContain('cursor-pointer');
      expect(button('Merge pull request')).toBeUndefined();
      expect(button('Close', box())).toBeDefined();
      expect(text()).toContain('Proposal compared with version 2.0');
      await act(async () => button('Resolve conflicts', box()).props.onClick());
      await flush();
      // The resolver opens over the whole window; the merge is confirmed back in the box.
      expect(view.root.findAll(node => node.type === 'div' && node.props.role === 'dialog')).toHaveLength(1);
      await act(async () => button('Done').props.onClick());
      expect(textOf(box())).toContain('Merge pull request');
      expect(button('Confirm merge')).toBeDefined();
      await act(async () => button('Cancel', box()).props.onClick());
      expect(button('Resolve conflicts', box())).toBeDefined();
      act(() => view.unmount());

      // Up to date: merging is one click away. Who may not merge is told who does.
      mocks.getPullRequest.mockResolvedValue(detail({ state: { kind: 'up-to-date' } }));
      await render(PR_ID);
      expect(textOf(box())).toContain('It is based on version 2.0, the latest public one.');
      expect(button('Merge pull request', box())).toBeDefined();
      act(() => view.unmount());
      mocks.getPullRequest.mockResolvedValue(detail({
        state: { kind: 'up-to-date' },
        permissions: { edit: false, editProposal: false, update: false, close: false, merge: false },
      }));
      await render(PR_ID);
      expect(textOf(box())).toContain('A maintainer of this pricing reviews and merges it.');
      expect(box().findAllByType('button')).toHaveLength(0);
      act(() => view.unmount());

      // Nothing to merge: no way to merge it.
      mocks.getPullRequest.mockResolvedValue(detail({ state: { kind: 'no-changes' } }));
      await render(PR_ID);
      expect(textOf(box())).toContain('Nothing to merge');
      expect(button('Merge pull request')).toBeUndefined();
      expect(button('Resolve conflicts')).toBeUndefined();
    });

    it('lets a maintainer merge with the page ETag, reading the version it follows from the page', async () => {
      mocks.getPullRequest.mockResolvedValue(detail({ state: { kind: 'behind', conflicts: 0 } }));
      const onMerged = vi.fn();
      const result = {
        pullRequest: detail({
          status: 'merged',
          state: { kind: 'merged' },
          merged: { at: new Date().toISOString(), versionId: 'v4', version: '2.1', followed: { versionId: 'v3', version: '3.0' } },
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
      await flush();
      expect(button('Update with latest version')).toBeUndefined();
      expect(text()).toContain('both combine without conflicts');
      await act(async () => button('Merge pull request').props.onClick());
      await flush();
      expect(mocks.previewPullRequestMerge).toHaveBeenCalledWith(PR_ID, 'merge', {});
      expect(text()).toContain('No conflicts');

      // Without conflicts, the result opens for review on Compare.
      await act(async () => button('Review the result').props.onClick());
      await flush();
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/static/pricings/acme/demo/3.0.yml', {});
      expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: LATEST_YAML, after: PROPOSED_YAML });
      await act(async () => button('Done').props.onClick());

      await act(async () => button('Confirm merge').props.onClick());
      expect(mocks.mergePullRequest).toHaveBeenCalledWith(
        PR_ID,
        { resolutions: {}, previewToken: 'token-1', version: '2.1', private: false },
        '"e.4"'
      );
      expect(onMerged).toHaveBeenCalledWith(result);
      expect(text()).toContain('Merged as 2.1');
      expect(button('Confirm merge')).toBeUndefined();
      expect(button('Merge pull request')).toBeUndefined();

      // The page has not loaded the new version yet: what was published is on its way, not an error.
      await flush();
      expect(view.root.findAll(node => node.props.role === 'alert')).toHaveLength(0);
      expect(text()).toContain('Reading versions 3.0 and 2.1…');
      const merged: VersionData = { ...latest, id: 'v4', version: '2.1', yaml: '/static/pricings/acme/demo/2.1.yml' };
      await act(async () => {
        view.update(
          <PricingPullRequestsTab
            pricingId={PRICING}
            selectedId={PR_ID}
            onSelect={onSelect}
            context={{ ...context, versions: [merged, latest], etag: '"e.5"', onMerged }}
          />
        );
      });
      await flush();
      expect(text()).toContain('Version 2.1 as it was published, compared with version 3.0');
    });

    it('shows what a merged pull request published against the version it was merged on, and what it proposed', async () => {
      const published: VersionData = { ...latest, id: 'v4', version: '2.1', yaml: '/static/pricings/acme/demo/2.1.yml' };
      const PUBLISHED_YAML = 'saasName: Demo\nversion: "2.1"\nplans:\n  PRO:\n    price: 11\n';
      fetchMock.mockImplementation(async (url: string) => new Response(url.endsWith('/2.1.yml') ? PUBLISHED_YAML : LATEST_YAML));
      mocks.getPullRequest.mockResolvedValue(detail({
        status: 'merged',
        state: { kind: 'merged' },
        merged: { at: new Date().toISOString(), versionId: 'v4', version: '2.1', followed: { versionId: 'v3', version: '3.0' } },
        permissions: { edit: false, editProposal: false, update: false, close: false, merge: false },
      }));
      await act(async () => {
        view = create(
          <PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={{ ...context, versions: [published, latest] }} />
        );
      });
      await flush();
      expect(text()).toContain('Version 2.1 as it was published, compared with version 3.0, the version it was merged on.');
      expect(button('Published').props['aria-pressed']).toBe(true);
      await act(async () => button('File').props.onClick());
      expect(view.root.findByType(FileDiffView).props).toMatchObject({
        before: LATEST_YAML, after: PUBLISHED_YAML, beforeLabel: 'Version 3.0', afterLabel: 'Version 2.1',
      });

      // The proposal as it was, one click away.
      await act(async () => button('Proposed').props.onClick());
      expect(text()).toContain('Proposal compared with version 2.0');
      expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: BASE_YAML, afterLabel: 'Proposal' });
      [button('Published'), button('Proposed')].forEach(item => expect(item.props.className).toContain('cursor-pointer'));
    });

    it('compares what was published with the version it was merged on as SPHERE upgrades it from an older syntax', async () => {
      const published: VersionData = { ...latest, id: 'v4', version: '2.1', yaml: '/static/pricings/acme/demo/2.1.yml' };
      const UPGRADED = 'saasName: Demo\nsyntaxVersion: "3.1"\nversion: "3.0"\nplans:\n  PRO:\n    price: 10\n';
      const PUBLISHED_YAML = UPGRADED.replace('version: "3.0"', 'version: "2.1"').replace('price: 10', 'price: 11');
      fetchMock.mockImplementation(async (url: string) => new Response(url.endsWith('/2.1.yml') ? PUBLISHED_YAML : LATEST_YAML));
      mocks.getPullRequest.mockResolvedValue(detail({
        status: 'merged',
        state: { kind: 'merged' },
        merged: {
          at: new Date().toISOString(), versionId: 'v4', version: '2.1',
          followed: { versionId: 'v3', version: '3.0', normalizedYaml: UPGRADED },
        },
      }));
      await act(async () => {
        view = create(
          <PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={{ ...context, versions: [published, latest] }} />
        );
      });
      await flush();
      expect(text()).toContain('Version 2.1 and version 3.0 are written in different Pricing2Yaml syntaxes.');
      // The stored text of 3.0 is not read: the upgraded one is compared.
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/static/pricings/acme/demo/2.1.yml']);
      await act(async () => button('File').props.onClick());
      expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: UPGRADED, after: PUBLISHED_YAML });

      // Back and forth between the two, the versions are not read again.
      await act(async () => button('Proposed').props.onClick());
      expect(text()).not.toContain('different Pricing2Yaml syntaxes');
      await act(async () => button('Published').props.onClick());
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('compares a version published in an older syntax than the one it was merged on as SPHERE upgrades it', async () => {
      const published: VersionData = { ...latest, id: 'v4', version: '2.1', yaml: '/static/pricings/acme/demo/2.1.yml' };
      const MERGED_UPGRADED = 'saasName: Demo\nsyntaxVersion: "3.1"\nversion: "2.1"\nplans:\n  PRO:\n    price: 11\n';
      fetchMock.mockImplementation(async () => new Response(LATEST_YAML));
      mocks.getPullRequest.mockResolvedValue(detail({
        status: 'merged',
        state: { kind: 'merged' },
        merged: {
          at: new Date().toISOString(), versionId: 'v4', version: '2.1', normalizedYaml: MERGED_UPGRADED,
          followed: { versionId: 'v3', version: '3.0' },
        },
      }));
      await act(async () => {
        view = create(
          <PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={{ ...context, versions: [published, latest] }} />
        );
      });
      await flush();
      expect(text()).toContain('Version 2.1 and version 3.0 are written in different Pricing2Yaml syntaxes.');
      // Only the version it was merged on is read: the merged one came upgraded.
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/static/pricings/acme/demo/3.0.yml']);
      await act(async () => button('File').props.onClick());
      expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: LATEST_YAML, after: MERGED_UPGRADED });
    });

    it('reads the published version again once the page has loaded it, as after a merge', async () => {
      const merged = detail({
        status: 'merged',
        state: { kind: 'merged' },
        merged: { at: new Date().toISOString(), versionId: 'v4', version: '2.1', followed: { versionId: 'v3', version: '3.0' } },
      });
      mocks.getPullRequest.mockResolvedValue(merged);
      const renderWith = (versions: VersionData[]) => (
        <PricingPullRequestsTab pricingId={PRICING} selectedId={PR_ID} onSelect={onSelect} context={{ ...context, versions }} />
      );
      await act(async () => {
        view = create(renderWith([latest]));
      });
      await flush();
      expect(textOf(view.root.findByProps({ role: 'alert' }))).toBe(
        'Version 2.1 could not be read: it is not loaded on this page. Reload the page and try again.'
      );
      await act(async () => {
        view.update(renderWith([{ ...latest, id: 'v4', version: '2.1', yaml: '/static/pricings/acme/demo/2.1.yml' }, latest]));
      });
      await flush();
      expect(view.root.findAll(node => node.props.role === 'alert')).toHaveLength(0);
      expect(text()).toContain('Version 2.1 as it was published');
    });

    it('lets the author bring a pull request behind the latest version up to it', async () => {
      mocks.user = { id: 'author', username: 'alice' };
      mocks.getPullRequest.mockResolvedValue(detail({
        permissions: { edit: true, editProposal: false, update: true, close: true, merge: false },
      }));
      await render(PR_ID);
      expect(button('Resolve conflicts')).toBeUndefined();
      expect(button('Merge pull request')).toBeUndefined();
      expect(text()).toContain('update your proposal to it, choosing a side for each');
      expect(button('Withdraw')).toBeDefined();
      // Its conflicts were known: the resolver opens at once over the whole window.
      await act(async () => button('Update with latest version').props.onClick());
      await flush();
      expect(mocks.previewPullRequestMerge).toHaveBeenCalledWith(PR_ID, 'update', {});
      expect(view.root.findAll(node => node.type === 'div' && node.props.role === 'dialog')).toHaveLength(1);
      await act(async () => button('Done').props.onClick());
      expect(text()).toContain('Update to the latest version');
      expect(button('Update pull request').props.disabled).toBe(false);
      await act(async () => button('Cancel').props.onClick());
      expect(button('Update with latest version')).toBeDefined();
      expect(text()).toContain('Proposal compared with version 2.0');
    });
  });
  it('offers no way to edit a proposal: a pull request is reviewed here, not written', async () => {
    mocks.user = { id: 'author', username: 'alice' };
    mocks.getPullRequest.mockResolvedValue(detail({
      permissions: { edit: true, editProposal: true, update: false, close: true, merge: false },
    }));
    await render(PR_ID);
    expect(button('Edit proposal')).toBeUndefined();
    expect(text()).not.toMatch(/editor/i);
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
      await act(async () => button('Upload proposal').props.onClick());
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

    it('disables "Upload proposal" with the reason when there is no public version (CA-7)', async () => {
      await renderList(page([], { proposals: { canOpen: false, reason: 'NO_PUBLIC_VERSION', latest: null } }));
      const propose = button('Upload proposal');
      expect(propose.props.disabled).toBe(true);
      expect(propose.props.className).toContain('disabled:cursor-default');
      expect(view.root.findByProps({ id: 'propose-block-reason' }).children.map(textOf).join('')).toBe(
        'This pricing has no public version to propose changes to.'
      );

      await act(async () => view.unmount());
      await renderList(page([], { proposals: { canOpen: false, reason: 'LIMIT_REACHED', latest: { id: 'v2', version: '2.0' } } }));
      expect(button('Upload proposal').props.disabled).toBe(true);
      expect(text()).toContain('You cannot open more pull requests on this pricing for now.');
    });

    it('proposes only uploaded files: there is no editor to write a proposal in', async () => {
      await renderList(page([]));
      const propose = button('Upload proposal');
      expect(propose.props.disabled).toBe(false);
      expect(propose.props.title).toBe('Propose a YAML file as the next version of 2.0');
      expect(view.root.findAll(node => node.props.role === 'menu' || node.props.role === 'menuitem')).toHaveLength(0);
      expect(text()).not.toMatch(/editor/i);
      await act(async () => propose.props.onClick());
      await flush();
      expect(view.root.findAllByType(FileUpload)).toHaveLength(1);
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
      expect(mocks.alert).toHaveBeenCalledWith(expect.stringContaining('Pull request #8 opened. SPHERE writes it in the latest Pricing2Yaml syntax'), 'success');
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

    it('does not open the pull request on a newer version this page cannot read until it is reloaded', async () => {
      mocks.listPullRequests.mockResolvedValue(page([]));
      await act(async () => {
        view = create(<PricingPullRequestsTab pricingId={PRICING} selectedId={null} onSelect={onSelect} context={withVersions} />);
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
      expect(text()).not.toContain('Changes against version 3.0');
      expect(button('Open pull request').props.disabled).toBe(true);
      expect(view.root.findByProps({ id: 'upload-block-reason' }).children.map(textOf).join('')).toBe(
        'Reload the page to review the changes against version 3.0.'
      );
      await act(async () => button('Open pull request').props.onClick());
      expect(mocks.createPullRequest).toHaveBeenCalledTimes(1);
    });

    it('gives every enabled button of the list and the upload dialog a pointer cursor (CA-37)', async () => {
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

    it('shows nothing while the fork has nothing its parent lacks, as a fork just made', async () => {
      await renderFork({ canPropose: false, reason: 'NO_CHANGES', parent });
      expect(view.toJSON()).toBeNull();
      expect(mocks.previewProposal).not.toHaveBeenCalled();
    });

    it('asks again when the page gets a new version of the fork, which may have something to propose', async () => {
      mocks.getForkTarget.mockResolvedValue({ canPropose: false, reason: 'NO_CHANGES', parent });
      const props = { forkPricingId: FORK, forkedFrom, canCreate: true, onProposed };
      await act(async () => {
        view = create(<ForkProposal {...props} latestVersionId="f1" />);
      });
      expect(view.toJSON()).toBeNull();
      mocks.getForkTarget.mockResolvedValue({ canPropose: true, parent });
      await act(async () => {
        view.update(<ForkProposal {...props} latestVersionId="f2" />);
      });
      expect(mocks.getForkTarget).toHaveBeenCalledTimes(2);
      expect(button('Propose changes to Demo').props.disabled).toBe(false);
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

    it('is not closed by a click outside, which would lose the choices; Close and Cancel close it', async () => {
      mocks.previewProposal.mockResolvedValue(forkPreview);
      await renderFork({ canPropose: true, parent });
      await act(async () => button('Propose changes to Demo').props.onClick());
      await flush();
      const dialog = () => view.root.findAll(node => node.type === 'div' && node.props.role === 'dialog');
      expect(dialog()).toHaveLength(1);
      expect(dialog()[0].props.onClick).toBeUndefined();
      expect(dialog()[0].props.className).not.toContain('cursor-pointer');
      await act(async () => button('Cancel').props.onClick());
      expect(dialog()).toHaveLength(0);
    });

    const openDialog = async (preview: PullRequestPreview) => {
      mocks.previewProposal.mockResolvedValue(preview);
      await renderFork({ canPropose: true, parent });
      await act(async () => button('Propose changes to Demo').props.onClick());
      await flush();
    };
    const plain = { ...forkPreview, warnings: [], existingPullRequest: undefined };
    const editor = () => view.root.findByProps({ 'data-editor': 'yaml' });
    const type = (yaml: string) => act(() => editor().props.onChange({ target: { value: yaml } }));
    const PRICE_CONFLICT: MergeConflict = {
      id: '["plans","PRO","price"]',
      path: ['plans', 'PRO', 'price'],
      label: 'plans.PRO.price',
      section: 'plans',
      entry: 'PRO',
      scope: 'value',
      base: { present: true, yaml: '10\n' },
      current: { present: true, yaml: '15\n' },
      proposal: { present: true, yaml: '12\n' },
    };

    it('keeps one height whatever the view shows, and each view shows only what it needs', async () => {
      await openDialog(plain);
      const classOf = (node: ReactTestInstance) => (typeof node.props.className === 'string' ? node.props.className : '');
      // The dialog has one height; the views scroll inside the area between its header and the title.
      const panel = view.root.find(node => node.type === 'div' && classOf(node).includes('sm:h-[min(88dvh,60rem)]'));
      expect(panel.findAll(node => node.type === 'div' && classOf(node).includes('min-h-0 flex-1 overflow-y-auto'))).toHaveLength(1);

      expect(text()).toContain('No conflicts');
      expect(text()).not.toMatch(/Your changes start from|can be combined as they are/);
      await act(async () => button('YAML').props.onClick());
      expect(editor().props.value).toBe(PROPOSED_YAML);
      // Only the file: no summary, no caption, no count of conflicts there are none of.
      expect(text()).not.toMatch(/Your changes start from|read-only|No conflicts|Edited by hand/);
    });

    it('lets the author type the proposal in the YAML view, and sends what they typed', async () => {
      mocks.createPullRequest.mockResolvedValue({ ...detail({ number: 8 }), warnings: [], updated: false });
      await openDialog(plain);
      act(() => view.root.findByType('input').props.onChange({ target: { value: 'Raise PRO' } }));
      await act(async () => button('YAML').props.onClick());
      expect(editor().props.readOnly).toBe(false);

      type('plans: [\n');
      expect(text()).toContain('Edited by hand: this text is what you propose.');
      expect(button('Open pull request').props.disabled).toBe(true);
      expect(view.root.findByProps({ id: 'fork-proposal-block-reason' }).children.map(textOf).join('')).toMatch(
        /^The YAML has an error on line \d+/
      );

      const typed = PROPOSED_YAML.replace('price: 12', 'price: 13');
      type(typed);
      expect(button('Open pull request').props.disabled).toBe(false);
      await act(async () => button('Open pull request').props.onClick());
      expect(mocks.createPullRequest).toHaveBeenCalledWith({
        title: 'Raise PRO',
        source: { kind: 'fork', forkPricingId: FORK },
        resolutions: {},
        manualYaml: typed,
        previewToken: 'fork-token',
      });
    });

    it('expands the views over the whole window and keeps what was typed when they come back', async () => {
      vi.stubGlobal('document', { body: { style: { overflow: '' } } });
      await openDialog(plain);
      await act(async () => button('YAML').props.onClick());
      await act(async () => button('Expand').props.onClick());
      const layer = () => view.root.findAll(node => node.props['aria-label'] === 'Resolver, expanded');
      expect(layer()).toHaveLength(1);
      // The dialog keeps its place: the title and buttons stay behind the expanded views.
      expect(button('Open pull request')).toBeDefined();
      type('saasName: Demo\n');
      expect(textOf(layer()[0])).toContain('Edited by hand');
      await act(async () => button('Collapse').props.onClick());
      expect(layer()).toHaveLength(0);
      expect(editor().props.value).toBe('saasName: Demo\n');
      vi.unstubAllGlobals();
    });

    it('goes back to the computed proposal by Discard my edits, or by choosing a side once the author agrees', async () => {
      mocks.confirm.mockResolvedValue(undefined);
      await openDialog({ ...plain, outcome: 'conflicts', conflicts: [PRICE_CONFLICT] });
      await act(async () => button('YAML').props.onClick());
      type('saasName: Demo\n');
      await act(async () => button('Discard my edits').props.onClick());
      expect(editor().props.value).toBe(PROPOSED_YAML);
      expect(text()).not.toContain('Edited by hand');

      // Typing the computed text back is not an edit.
      type('saasName: Demo\n');
      type(PROPOSED_YAML);
      expect(text()).not.toContain('Edited by hand');

      type('saasName: Demo\n');
      await act(async () => button('Conflicts').props.onClick());
      await act(async () => button('Use proposal').props.onClick());
      expect(mocks.confirm).toHaveBeenCalledWith(
        'Choosing a side computes the result again and discards your edits to the YAML.',
        { confirmLabel: 'Discard my edits', cancelLabel: 'Keep editing' }
      );
      expect(button('Use proposal').props['aria-pressed']).toBe(true);
      await act(async () => button('YAML').props.onClick());
      expect(editor().props.value).toBe(PROPOSED_YAML);
    });

    it('proposes the newest version of the fork by default and lets the author pick another one', async () => {
      const versions = [
        { id: 'f3', version: '1.2', private: false, addedAt: '2026-11-20T10:00:00.000Z' },
        { id: 'f2', version: '1.1', private: true, addedAt: null },
      ];
      mocks.previewProposal.mockResolvedValue({ ...plain, outcome: 'conflicts', conflicts: [PRICE_CONFLICT] });
      mocks.createPullRequest.mockResolvedValue({ ...detail({ number: 8 }), warnings: [], updated: false });
      mocks.confirm.mockRejectedValueOnce(undefined);
      await renderFork({ canPropose: true, parent, versions });
      await act(async () => button('Propose changes to Demo').props.onClick());
      await flush();
      const picker = () => view.root.findByProps({ id: 'fork-proposal-version' });
      expect(picker().props.value).toBe('f3');
      expect(picker().props.className).toContain('cursor-pointer');
      expect(picker().findAllByType('option').map(option => option.children.map(textOf).join(''))).toEqual([
        expect.stringMatching(/^1\.2 · latest · /),
        '1.1 · private',
      ]);
      expect(mocks.previewProposal).toHaveBeenLastCalledWith({ kind: 'fork', forkPricingId: FORK, versionId: 'f3' }, {});

      // A choice made on one version is not carried to another.
      await act(async () => button('Use proposal').props.onClick());
      mocks.previewProposal.mockResolvedValue(plain);
      await act(async () => picker().props.onChange({ target: { value: 'f2' } }));
      await flush();
      expect(mocks.previewProposal).toHaveBeenLastCalledWith({ kind: 'fork', forkPricingId: FORK, versionId: 'f2' }, {});
      expect(picker().props.value).toBe('f2');

      // With the YAML typed by hand, another version asks first; kept edits keep the version.
      await act(async () => button('YAML').props.onClick());
      type('saasName: Demo\n');
      await act(async () => picker().props.onChange({ target: { value: 'f3' } }));
      await flush();
      expect(mocks.confirm).toHaveBeenCalledWith(
        'Proposing another version computes the proposal again and discards your edits to the YAML.',
        { confirmLabel: 'Discard my edits', cancelLabel: 'Keep editing' }
      );
      expect(picker().props.value).toBe('f2');
      expect(editor().props.value).toBe('saasName: Demo\n');
      await act(async () => button('Discard my edits').props.onClick());

      act(() => view.root.findByType('input').props.onChange({ target: { value: 'From 1.1' } }));
      await act(async () => button('Open pull request').props.onClick());
      expect(mocks.createPullRequest).toHaveBeenCalledWith({
        title: 'From 1.1',
        source: { kind: 'fork', forkPricingId: FORK, versionId: 'f2' },
        resolutions: {},
        previewToken: 'fork-token',
      });
    });

    it('shows no version picker when the fork has one version to propose', async () => {
      await renderFork({ canPropose: true, parent, versions: [{ id: 'f2', version: '1.1', private: false, addedAt: null }] });
      mocks.previewProposal.mockResolvedValue(plain);
      await act(async () => button('Propose changes to Demo').props.onClick());
      await flush();
      expect(view.root.findAllByProps({ id: 'fork-proposal-version' })).toHaveLength(0);
      expect(text()).toContain('The latest version of this fork');
      expect(mocks.previewProposal).toHaveBeenLastCalledWith({ kind: 'fork', forkPricingId: FORK, versionId: 'f2' }, {});
    });
  });
});
