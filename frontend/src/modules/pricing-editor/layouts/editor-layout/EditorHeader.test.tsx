import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditorHeader from './editor-header';
import type { EditorSourcePricing } from '../../contexts/editorValueContext';
import { parseDraftFromYaml, serializeDraftToYaml, type PricingDraft } from '../../services/pricing2yaml';

const mocks = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
  createPullRequest: vi.fn(),
  editPullRequest: vi.fn(),
  saveDraft: vi.fn(),
  setEditorValue: vi.fn(),
  editor: {
    sourcePricing: null as EditorSourcePricing | null,
    editorValue: 'saasName: Demo\n',
    editorMode: 'code',
    isDirty: false,
    pendingVisualDraft: null as PricingDraft | null,
  },
}));
vi.mock('../../../pricing/api/pricingPullRequestsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../pricing/api/pricingPullRequestsApi')>()),
  usePricingPullRequestsApi: () => ({
    listPullRequests: mocks.listPullRequests,
    getPullRequest: mocks.getPullRequest,
    createPullRequest: mocks.createPullRequest,
    editPullRequest: mocks.editPullRequest,
  }),
}));
vi.mock('../../../auth/hooks/useAuth', () => ({
  useAuth: () => ({ authUser: { isAuthenticated: true, isLoading: false, token: 'token', user: { id: 'u1', username: 'alice' } } }),
}));
vi.mock('../../../core/hooks/useRouter', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../hooks/useEditorValue', () => ({
  useEditorValue: () => ({
    editorValue: mocks.editor.editorValue,
    setEditorValue: mocks.setEditorValue,
    editorMode: mocks.editor.editorMode,
    setEditorMode: vi.fn(),
    isDirty: mocks.editor.isDirty,
    setIsDirty: vi.fn(),
    pendingVisualDraft: mocks.editor.pendingVisualDraft,
    setPendingVisualDraft: vi.fn(),
    saveDraft: mocks.saveDraft,
    sourcePricing: mocks.editor.sourcePricing,
  }),
}));
vi.mock('./editor-account-menu', () => ({ default: () => null }));
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

const SOURCE: EditorSourcePricing = {
  organizationId: 'acme',
  slug: 'demo',
  collectionSlug: 'main',
  name: 'Demo',
  version: '2.0',
  pricingId: '6650f0c0c0c0c0c0c0c0c001',
  versionId: '6650f0c0c0c0c0c0c0c0c0a2',
  baseYaml: 'saasName: Demo\n',
};

const classes = (node: ReactTestInstance) => String(node.props.className ?? '').split(/\s+/);
const part = (root: ReactTestInstance, name: string) => root.find(node => node.props['data-header-part'] === name);

/**
 * jsdom measures no layout, so this fixes the classes the layout was measured with in Chrome
 * (R1): no header control may lie under the Code/Visual toggle, at any width.
 */
describe('the editor header with "Propose changes" (R1)', () => {
  let view: ReactTestRenderer;

  async function render(sourcePricing: EditorSourcePricing | null) {
    mocks.editor.sourcePricing = sourcePricing;
    await act(async () => {
      view = create(<EditorHeader onShareLink={() => {}} onImport={() => {}} />);
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(mocks.editor, { editorValue: 'saasName: Demo\n', editorMode: 'code', isDirty: false, pendingVisualDraft: null });
    mocks.listPullRequests.mockResolvedValue({
      proposals: { canOpen: true, reason: null, latest: { id: SOURCE.versionId, version: '2.0' } },
    });
    // The menus close on outside clicks, listened for on the document.
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  it('keeps the mode toggle in a column of its own, never positioned over the other groups', async () => {
    await render(SOURCE);
    const header = view.root.findByType('header');
    // One row from md: the toggle's column stays centred while both sides fit and moves aside otherwise.
    expect(classes(header)).toEqual(expect.arrayContaining(['grid', 'grid-cols-[auto_1fr_auto_auto]', 'md:grid-cols-[1fr_auto_1fr]']));
    expect(classes(header)).not.toContain('sm:flex');
    const mode = part(view.root, 'mode');
    expect(classes(mode).filter(name => /absolute|translate|left-1\/2/.test(name))).toEqual([]);
    // Below md a row of its own; from md the middle column.
    expect(classes(mode)).toEqual(expect.arrayContaining(['col-start-1', 'col-span-4', 'row-start-2', 'md:col-start-2', 'md:col-span-1', 'md:row-start-1']));
  });

  it('puts "Propose changes" next to Publish from md, and in the toggle\'s row below it', async () => {
    await render(SOURCE);
    const actions = part(view.root, 'actions');
    expect(classes(actions)).toEqual(expect.arrayContaining(['contents', 'md:flex', 'md:col-start-3', 'md:justify-self-end']));
    const propose = part(view.root, 'propose');
    expect(propose.parent).toBe(actions);
    expect(classes(propose)).toEqual(expect.arrayContaining(['col-start-3', 'col-span-2', 'row-start-2', 'justify-self-end']));
    // Between the menus and Publish, as in one row.
    const children = actions.children as ReactTestInstance[];
    expect(children.indexOf(propose)).toBe(1);
    expect(children[2].findAll(node => node.type === 'button').some(node => String(node.props.className).includes('bg-tp-primary'))).toBe(true);
  });

  it('shows "Propose changes" as an icon named by its label below 2xl', async () => {
    await render(SOURCE);
    const button = view.root.find(node => node.type === 'button' && node.props['aria-label'] === 'Propose changes');
    expect(button.props.disabled).toBe(false);
    expect(button.props.title).toBe('Propose changes');
    const label = button.findAll(node => node.type === 'span')[0];
    expect(classes(label)).toEqual(['hidden', '2xl:inline']);
    expect(button.props.className).toContain('cursor-pointer');
  });

  it('adds nothing to the toggle\'s row without a published version open', async () => {
    await render(null);
    expect(view.root.findAll(node => node.props['data-header-part'] === 'propose')).toHaveLength(0);
    expect(mocks.listPullRequests).not.toHaveBeenCalled();
  });
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

/**
 * The visual editor keeps its changes in a draft until Save writes them to the YAML: "Propose
 * changes" proposes what the user sees, the draft included, and saves nothing.
 */
describe('"Propose changes" with the visual editor\'s unsaved draft', () => {
  const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';
  const BASE_YAML = 'saasName: Demo\nversion: "2.0"\nplans:\n  BASIC:\n    price: 0\n  PRO:\n    price: 10\n';
  let view: ReactTestRenderer;
  const buttons = () => view.root.findAll(node => node.type === 'button');
  /** The header's button (named by aria-label) first, then the dialog's (named by its text). */
  const byLabel = (label: string) =>
    buttons().filter(node => node.props['aria-label'] === label || (node.props['aria-label'] === undefined && textOf(node).trim() === label));

  /** The saved text is the version's; the draft raises PRO to 12 and was not saved. */
  function draftRaisingPro(): PricingDraft {
    const draft = parseDraftFromYaml(BASE_YAML);
    draft.plans.PRO = { ...draft.plans.PRO, price: 12 };
    return draft;
  }

  async function render(sourcePricing: EditorSourcePricing, editor: Partial<typeof mocks.editor>) {
    Object.assign(mocks.editor, { sourcePricing, editorValue: BASE_YAML, ...editor });
    await act(async () => {
      view = create(<EditorHeader onShareLink={() => {}} onImport={() => {}} />);
    });
  }

  async function open(label: string) {
    await act(async () => byLabel(label)[0].props.onClick());
    act(() => view.root.findByType('input').props.onChange({ target: { value: 'Raise PRO' } }));
  }

  async function submit(label: string) {
    const button = byLabel(label)[1];
    expect(button.props.disabled).toBe(false);
    await act(async () => button.props.onClick());
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listPullRequests.mockResolvedValue({
      proposals: { canOpen: true, reason: null, latest: { id: SOURCE.versionId, version: '2.0' } },
    });
    mocks.createPullRequest.mockResolvedValue({ id: PR_ID, number: 9, warnings: [] });
    mocks.getPullRequest.mockResolvedValue({ id: PR_ID, title: 'Raise PRO', description: '' });
    mocks.editPullRequest.mockResolvedValue({ id: PR_ID, number: 7, warnings: [] });
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  it('opens a pull request with the draft\'s changes, without saving them to the editor', async () => {
    const draft = draftRaisingPro();
    await render({ ...SOURCE, baseYaml: BASE_YAML }, { editorMode: 'visual', isDirty: true, pendingVisualDraft: draft });
    await open('Propose changes');
    // The summary is of the draft, not of the saved text (which is the version itself).
    expect(textOf(view.root)).toContain('~PRO');
    expect(textOf(view.root)).not.toContain('Nothing to propose');
    await submit('Propose changes');

    const proposedYaml = mocks.createPullRequest.mock.calls[0][0].source.proposedYaml as string;
    expect(proposedYaml).toBe(serializeDraftToYaml(draft));
    expect(parseDraftFromYaml(proposedYaml).plans.PRO.price).toBe(12);
    // Save and Publish work as before: nothing was saved or written to the editor.
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.setEditorValue).not.toHaveBeenCalled();
  });

  it('updates an open pull request (&pr=) with the draft\'s changes too', async () => {
    const draft = draftRaisingPro();
    await render({ ...SOURCE, baseYaml: BASE_YAML, pullRequestId: PR_ID }, { editorMode: 'visual', isDirty: true, pendingVisualDraft: draft });
    await open('Update pull request');
    await submit('Update pull request');
    expect(mocks.editPullRequest).toHaveBeenCalledWith(PR_ID, {
      title: 'Raise PRO',
      description: '',
      proposedYaml: serializeDraftToYaml(draft),
    });
  });

  it('proposes the editor\'s text when no draft is pending (a discarded one is left behind)', async () => {
    const edited = BASE_YAML.replace('price: 10', 'price: 15');
    await render({ ...SOURCE, baseYaml: BASE_YAML }, { editorValue: edited, isDirty: false, pendingVisualDraft: draftRaisingPro() });
    await open('Propose changes');
    await submit('Propose changes');
    expect(mocks.createPullRequest.mock.calls[0][0].source.proposedYaml).toBe(edited);
  });
});
