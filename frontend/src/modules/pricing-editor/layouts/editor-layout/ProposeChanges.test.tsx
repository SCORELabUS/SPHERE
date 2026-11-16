import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProposeChangesButton from './propose-changes-button';
import FileDiffView from '../../../pricing/components/pricing-version-diff/file-diff-view';
import { PullRequestApiError } from '../../../pricing/api/pricingPullRequestsApi';
import { editorPath, pickSourceVersion } from '../../utils/editor-source';
import type { EditorSourcePricing } from '../../contexts/editorValueContext';
import type { PullRequestList, PullRequestPreview } from '../../../pricing/types/pull-requests';

const mocks = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
  createPullRequest: vi.fn(),
  editPullRequest: vi.fn(),
  previewProposal: vi.fn(),
  getPricingBySlug: vi.fn(),
}));
vi.mock('../../../pricing/api/pricingPullRequestsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../pricing/api/pricingPullRequestsApi')>()),
  usePricingPullRequestsApi: () => mocks,
}));
vi.mock('../../../pricing/api/pricingsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../pricing/api/pricingsApi')>()),
  usePricingsApi: () => ({ getPricingBySlug: mocks.getPricingBySlug }),
}));
vi.mock('../../../auth/hooks/useAuth', () => ({
  useAuth: () => ({ authUser: { isAuthenticated: true, token: 'token', user: { id: 'u1', username: 'alice' } } }),
}));
// Plain elements instead of animations.
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
const V1 = '6650f0c0c0c0c0c0c0c0c0a1';
const V2 = '6650f0c0c0c0c0c0c0c0c0a2';
const V3 = '6650f0c0c0c0c0c0c0c0c0a3';
const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';
const BASE_YAML = 'saasName: Demo\nversion: "2.0"\nplans:\n  BASIC:\n    price: 0\n  PRO:\n    price: 10\n';
const EDITED_YAML = 'saasName: Demo\nversion: "2.1"\nplans:\n  BASIC:\n    price: 0\n  PRO:\n    price: 12\n';
const LATEST_YAML = 'saasName: Demo\nversion: "3.0"\nplans:\n  BASIC:\n    price: 5\n  PRO:\n    price: 10\n';

const source = (overrides: Partial<EditorSourcePricing> = {}): EditorSourcePricing => ({
  organizationId: 'acme',
  slug: 'demo',
  collectionSlug: 'main',
  name: 'Demo',
  version: '2.0',
  pricingId: PRICING,
  versionId: V2,
  baseYaml: BASE_YAML,
  ...overrides,
});

const proposals = (overrides: Partial<PullRequestList['proposals']> = {}): Pick<PullRequestList, 'proposals'> => ({
  proposals: { canOpen: true, reason: null, latest: { id: V2, version: '2.0' }, ...overrides },
});

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

describe('the editor source', () => {
  const versions = [
    { id: V3, version: '3.0' },
    { id: V2, version: '2.0' },
  ];

  it('opens the version named by id, and only then says it was found by id (CA-87)', () => {
    expect(pickSourceVersion(versions, { versionId: V2, version: '9.9' })).toEqual({ version: versions[1], byId: true });
    // A label taken again by a version created after the one the link named.
    expect(pickSourceVersion(versions, { versionId: V1, version: '2.0' })).toEqual({ version: versions[1], byId: false });
    // Older links name only the label; with nothing found, Publish still has the newest version.
    expect(pickSourceVersion(versions, { version: '2.0' })).toEqual({ version: versions[1], byId: false });
    expect(pickSourceVersion(versions, { versionId: V1, version: '1.0' })).toEqual({ version: versions[0], byId: false });
  });

  it('links the editor to a version by id and label, and to an open pull request', () => {
    const query = (path: string) => Object.fromEntries(new URLSearchParams(path.split('?')[1]));
    expect(query(editorPath({ organizationId: 'acme', slug: 'demo' }, { id: V2, version: '2.0' }))).toEqual({
      source: 'acme/demo', version: '2.0', versionId: V2, mode: 'code',
    });
    expect(
      query(editorPath({ organizationId: 'acme', slug: 'demo', collectionSlug: 'main' }, { id: V2, version: '2.0' }, { mode: 'visual', pullRequestId: PR_ID }))
    ).toEqual({ source: 'acme/demo', version: '2.0', versionId: V2, mode: 'visual', collection: 'main', pr: PR_ID });
  });
});

describe('Propose changes in the editor', () => {
  let view: ReactTestRenderer;
  const text = () => textOf(view.root);
  const buttons = () => view.root.findAllByType('button');
  const button = (label: string) => buttons().find(item => textOf(item).trim() === label)!;
  const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 5)));
  const fetchMock = vi.fn();

  async function render(from: EditorSourcePricing, yaml = EDITED_YAML) {
    await act(async () => {
      view = create(<ProposeChangesButton source={from} readYaml={() => yaml} />);
    });
  }

  async function openAndTitle(title = 'Raise PRO') {
    await act(async () => button('Propose changes').props.onClick());
    act(() => view.root.findByType('input').props.onChange({ target: { value: title } }));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listPullRequests.mockResolvedValue(proposals());
    fetchMock.mockImplementation(async () => new Response(LATEST_YAML));
    vi.stubGlobal('fetch', fetchMock);
    // The reason's popover closes on outside clicks, listened for on the document.
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  it('is active only on the latest public version, compared by id (CA-21)', async () => {
    await render(source());
    expect(mocks.listPullRequests).toHaveBeenCalledWith(PRICING, { status: 'open' });
    expect(button('Propose changes').props.disabled).toBe(false);
    expect(button('Propose changes').props.className).toContain('cursor-pointer');
    expect(view.root.findAll(node => node.props['aria-label'] === 'Why proposing changes is not available')).toHaveLength(0);
  });

  it('is disabled on another version, with the reason and a link to the latest in another tab (CA-21)', async () => {
    mocks.listPullRequests.mockResolvedValue(proposals({ latest: { id: V3, version: '3.0' } }));
    // A private version newer than the latest public one, or an older one: neither is the latest public.
    await render(source({ version: '3.1', versionId: '6650f0c0c0c0c0c0c0c0c0a4' }));
    const propose = button('Propose changes');
    expect(propose.props.disabled).toBe(true);
    expect(propose.props.className).toContain('disabled:cursor-default');
    expect(propose.props.title).toBe(
      'Pull requests start from the latest public version (3.0), and this editor holds version 3.1.'
    );

    const why = view.root.find(node => node.props['aria-label'] === 'Why proposing changes is not available');
    expect(why.props.className).toContain('cursor-pointer');
    await act(async () => why.props.onClick());
    expect(textOf(view.root.findByProps({ role: 'note' }))).toContain('this editor holds version 3.1');
    const link = view.root.findByType('a');
    expect(link.props).toMatchObject({ target: '_blank', rel: 'noreferrer noopener' });
    expect(textOf(link)).toBe('Open latest version (3.0)');
    const query = Object.fromEntries(new URLSearchParams(String(link.props.href).split('?')[1]));
    expect(String(link.props.href).startsWith('/editor?')).toBe(true);
    expect(query).toEqual({ source: 'acme/demo', version: '3.0', versionId: V3, mode: 'code', collection: 'main' });
  });

  it('keeps the reason inside a phone screen, hung from the header instead of the button (CA-21)', async () => {
    mocks.listPullRequests.mockResolvedValue(proposals({ latest: { id: V3, version: '3.0' } }));
    await render(source({ version: '3.1', versionId: '6650f0c0c0c0c0c0c0c0c0a4' }));
    const why = view.root.find(node => node.props['aria-label'] === 'Why proposing changes is not available');
    await act(async () => why.props.onClick());
    const note = view.root.findByProps({ role: 'note' });
    const classes = (node: ReactTestInstance) => String(node.props.className).split(/\s+/);
    // Below `sm` the button's wrapper is not positioned, so the note spans the sticky header with a gutter.
    expect(classes(note.parent!)).not.toContain('relative');
    expect(classes(note.parent!)).toContain('sm:relative');
    expect(classes(note)).toEqual(expect.arrayContaining(['absolute', 'inset-x-3', 'break-words']));
    expect(classes(note)).not.toContain('w-72');
    // From `sm` on it hangs from the button again, at its usual width.
    expect(classes(note)).toEqual(expect.arrayContaining(['sm:inset-x-auto', 'sm:right-0', 'sm:w-72']));
  });

  it('is disabled when the editor was not opened on a version by id, even if the label matches (CA-87)', async () => {
    await render(source({ versionId: undefined }));
    expect(button('Propose changes').props.disabled).toBe(true);
  });

  it('says why when no pull request can be opened, without a link', async () => {
    mocks.listPullRequests.mockResolvedValue(proposals({ canOpen: false, reason: 'NO_PUBLIC_VERSION', latest: null }));
    await render(source());
    expect(button('Propose changes').props.disabled).toBe(true);
    expect(button('Propose changes').props.title).toBe('This pricing has no public version to propose changes to.');
    await act(async () =>
      view.root.find(node => node.props['aria-label'] === 'Why proposing changes is not available').props.onClick()
    );
    expect(view.root.findAllByType('a')).toHaveLength(0);
  });

  it('opens a pull request with the editor text, its summary and the version it is based on', async () => {
    mocks.createPullRequest.mockResolvedValue({ id: PR_ID, number: 9, warnings: [] });
    await render(source());
    await openAndTitle();
    expect(text()).toContain('Demo · based on version 2.0');
    expect(text()).toContain('~PRO');
    expect(text()).toContain('Prices change: PRO');

    await act(async () => button('Propose changes').props.onClick());
    const submit = buttons().filter(item => textOf(item).trim() === 'Propose changes');
    expect(submit).toHaveLength(2);
    await act(async () => submit[1].props.onClick());
    expect(mocks.createPullRequest).toHaveBeenCalledWith({
      title: 'Raise PRO',
      source: { kind: 'text', pricingId: PRICING, baseVersionId: V2, proposedYaml: EDITED_YAML },
    });
    expect(text()).toContain('Pull request #9 opened.');
    const link = view.root.findByType('a');
    expect(link.props.target).toBe('_blank');
    expect(link.props.href).toBe(`/pricings/acme/demo?tab=pull-requests&pr=${PR_ID}&collection=main`);
  });

  it('says there is nothing to propose when the text is the version it is based on (CA-15)', async () => {
    await render(source(), BASE_YAML.replace('version: "2.0"', 'version: "2.1"'));
    await openAndTitle();
    expect(text()).toContain('Nothing to propose: the text is the same as version 2.0.');
    const submit = buttons().filter(item => textOf(item).trim() === 'Propose changes');
    expect(submit[1].props.disabled).toBe(true);
  });

  it('keeps the text when a newer public version appeared, and applies the changes on top of it (CA-23)', async () => {
    mocks.createPullRequest.mockRejectedValueOnce(
      new PullRequestApiError(409, { error: 'x', code: 'BASE_NOT_LATEST', latest: { id: V3, version: '3.0' } })
    );
    const preview: PullRequestPreview = {
      base: { id: V2, version: '2.0' },
      target: { id: V3, version: '3.0' },
      outcome: 'merged',
      conflicts: [],
      resultYaml: 'saasName: Demo\nversion: "2.1"\nplans:\n  BASIC:\n    price: 5\n  PRO:\n    price: 12\n',
      regenerated: true,
      validation: { ok: true },
      warnings: [{ code: 'FORMAT_REGENERATED' }],
      previewToken: 'text-token',
      suggestedVersion: '2.1',
    };
    mocks.previewProposal.mockResolvedValue(preview);
    mocks.getPricingBySlug.mockResolvedValue({ pricingId: PRICING, versions: [{ id: V3, yaml: '/static/pricings/acme/demo/3.0.yml' }] });
    mocks.createPullRequest.mockResolvedValueOnce({ id: PR_ID, number: 10, warnings: [] });
    const yaml = EDITED_YAML;
    await render(source(), yaml);
    await openAndTitle();
    await act(async () => buttons().filter(item => textOf(item).trim() === 'Propose changes')[1].props.onClick());

    expect(view.root.findByProps({ role: 'alert' }).findByType('span').children.join('')).toBe(
      'A newer public version (3.0) was published. Proposals start from the latest public version.'
    );
    expect(text()).toContain('Your text in the editor stays as it is.');
    // Until there is a merge to resolve, a click outside closes the dialog as usual.
    const dialog = () => view.root.findByProps({ role: 'dialog' });
    expect(dialog().props.onClick).toBeTypeOf('function');

    await act(async () => button('Apply my changes on top of the latest').props.onClick());
    await flush();
    // Then it does not, so the choices are not lost by a stray click (Close and Cancel still close).
    expect(dialog().props.onClick).toBeUndefined();
    expect(dialog().props.className).not.toContain('cursor-pointer');
    // The proposal against the version it was written on, merged with the latest public one.
    expect(mocks.previewProposal).toHaveBeenCalledWith(
      { kind: 'text', pricingId: PRICING, baseVersionId: V2, proposedYaml: yaml },
      {}
    );
    expect(text()).toContain('Merging into version 3.0, from the base version 2.0.');
    expect(view.root.findByProps({ 'data-warning': 'FORMAT_REGENERATED' })).toBeTruthy();
    expect(view.root.findByType('input').props.value).toBe('Raise PRO');

    await act(async () => button('Compare').props.onClick());
    await flush();
    expect(mocks.getPricingBySlug).toHaveBeenCalledWith('demo', 'acme', 'main');
    expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: LATEST_YAML, after: preview.resultYaml });

    await act(async () => button('Open pull request').props.onClick());
    expect(mocks.createPullRequest).toHaveBeenLastCalledWith({
      title: 'Raise PRO',
      source: { kind: 'text', pricingId: PRICING, baseVersionId: V3, proposedYaml: preview.resultYaml },
    });
    expect(text()).toContain('Pull request #10 opened.');
  });

  it('updates the open pull request the editor was opened on', async () => {
    mocks.getPullRequest.mockResolvedValue({ id: PR_ID, title: 'Raise PRO', description: 'Why' });
    mocks.editPullRequest.mockResolvedValue({ id: PR_ID, number: 7, warnings: [{ code: 'SYNTAX_UPGRADED' }] });
    await render(source({ pullRequestId: PR_ID }));
    expect(mocks.listPullRequests).not.toHaveBeenCalled();
    await act(async () => button('Update pull request').props.onClick());
    expect(mocks.getPullRequest).toHaveBeenCalledWith(PR_ID);
    expect(view.root.findByType('input').props.value).toBe('Raise PRO');
    expect(view.root.findByType('textarea').props.value).toBe('Why');

    const submit = buttons().filter(item => textOf(item).trim() === 'Update pull request');
    await act(async () => submit[1].props.onClick());
    expect(mocks.editPullRequest).toHaveBeenCalledWith(PR_ID, { title: 'Raise PRO', description: 'Why', proposedYaml: EDITED_YAML });
    expect(text()).toContain('Pull request #7 updated.');
    expect(text()).toContain('older Pricing2Yaml syntax');
  });

  it('explains an update refused because the pull request is behind', async () => {
    mocks.getPullRequest.mockResolvedValue({ id: PR_ID, title: 'Raise PRO', description: '' });
    mocks.editPullRequest.mockRejectedValue(new PullRequestApiError(409, { error: 'x', code: 'PULL_REQUEST_BEHIND' }));
    await render(source({ pullRequestId: PR_ID }));
    await act(async () => button('Update pull request').props.onClick());
    await act(async () => buttons().filter(item => textOf(item).trim() === 'Update pull request')[1].props.onClick());
    expect(text()).toContain('Update the pull request to the latest before changing its proposal.');
    expect(button('Apply my changes on top of the latest')).toBeUndefined();
  });

  it('gives every enabled button a pointer cursor (CA-37)', async () => {
    await render(source());
    await openAndTitle();
    const enabled = buttons().filter(item => !item.props.disabled);
    expect(enabled.length).toBeGreaterThan(2);
    enabled.forEach(item => expect(item.props.className).toContain('cursor-pointer'));
  });
});
