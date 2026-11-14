import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditorHeader from './editor-header';
import type { EditorSourcePricing } from '../../contexts/editorValueContext';

const mocks = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  editor: { sourcePricing: null as EditorSourcePricing | null },
}));
vi.mock('../../../pricing/api/pricingPullRequestsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../pricing/api/pricingPullRequestsApi')>()),
  usePricingPullRequestsApi: () => ({ listPullRequests: mocks.listPullRequests }),
}));
vi.mock('../../../auth/hooks/useAuth', () => ({
  useAuth: () => ({ authUser: { isAuthenticated: true, isLoading: false, token: 'token', user: { id: 'u1', username: 'alice' } } }),
}));
vi.mock('../../../core/hooks/useRouter', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../hooks/useEditorValue', () => ({
  useEditorValue: () => ({
    editorValue: 'saasName: Demo\n',
    setEditorValue: vi.fn(),
    editorMode: 'code',
    setEditorMode: vi.fn(),
    isDirty: false,
    setIsDirty: vi.fn(),
    saveDraft: vi.fn(),
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
