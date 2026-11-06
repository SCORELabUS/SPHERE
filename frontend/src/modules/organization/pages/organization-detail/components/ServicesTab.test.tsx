import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServicesTab from './ServicesTab';
import ServiceOutline from './services/ServiceOutline';
import ServiceJsonEditor from './services/ServiceJsonEditor';
import type { Organization } from '../../../api/organizationsApi';
import type { ServiceTreeView } from '../../../api/serviceTreeApi';

const mocks = vi.hoisted(() => ({
  getServiceTree: vi.fn(), saveServiceTree: vi.fn(), getOrgPricings: vi.fn(),
}));
vi.mock('../../../api/serviceTreeApi', () => ({
  useServiceTreeApi: () => mocks,
  ServiceTreeConflictError: class extends Error {},
}));
vi.mock('../../../api/organizationsApi', () => ({ useOrganizationsApi: () => mocks }));
vi.mock('../../../../core/components/iconify', () => ({ default: () => null }));
vi.mock('../../../../core/components/confirm-modal', () => ({ default: () => null }));
vi.mock('./services/ServiceOutline', () => ({ default: () => null }));
vi.mock('./services/ServiceDetail', () => ({ default: () => null }));
vi.mock('./services/ServiceTreeNode', () => ({ default: () => null, ROOT_TARGET: 'root' }));
vi.mock('./services/ServiceJsonEditor', () => ({ default: () => null }));

const tree: ServiceTreeView = {
  nodes: [{ id: 'service', parentId: null, name: 'Original', description: '', kind: null,
    dependency: null, pricingIds: [], attributes: {}, interfaces: [], links: [] }],
  revision: 1, updatedAt: null, pricings: {}, canEdit: true,
};
const org = { id: 'org', displayName: 'Organization' } as Organization;

describe('ServicesTab saving', () => {
  let view: ReactTestRenderer;
  const button = (text: string) => view.root.findAllByType('button').find(
    item => item.children.some(child => child === text)
  )!;
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.getServiceTree.mockResolvedValue(tree);
    mocks.getOrgPricings.mockResolvedValue({ pricings: [] });
    await act(async () => { view = create(<ServicesTab org={org} />); });
    await act(async () => { button('Edit').props.onClick(); });
    act(() => {
      view.root.findByType(ServiceOutline).props.actions.update('service', { name: 'Submitted' }, 'name');
    });
  });
  afterEach(() => {
    act(() => view.unmount());
    vi.unstubAllGlobals();
  });

  it.each([false, true])('locks controls and draft actions until save settles (fails=%s)', async fails => {
    let resolve!: (value: ServiceTreeView) => void;
    let reject!: (reason: Error) => void;
    mocks.saveServiceTree.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const save = button('Save').props.onClick;
    let pending!: Promise<void>;
    act(() => { pending = save(); });
    expect(view.root.findByType('fieldset').props.disabled).toBe(true);
    expect(view.root.findByType('fieldset').props['aria-busy']).toBe(true);
    const before = view.root.findByType(ServiceOutline).props.nodes;
    await act(async () => {
      // Drag/drop actions, keyboard undo and a repeated save must also be blocked.
      view.root.findByType(ServiceOutline).props.actions.update('service', { name: 'Lost edit' }, 'name');
      view.root.findAllByType('button').find(item => item.props['aria-label'] === 'Undo')!.props.onClick();
      await save();
    });
    expect(view.root.findByType(ServiceOutline).props.nodes).toEqual(before);
    expect(mocks.saveServiceTree).toHaveBeenCalledOnce();
    await act(async () => {
      if (fails) reject(new Error('Save failed'));
      else resolve({ ...tree, nodes: before, revision: 2 });
      await pending;
    });
    expect(view.root.findByType('fieldset').props.disabled).toBe(false);
    expect(view.root.findByType(ServiceOutline).props.nodes[0].name).toBe('Submitted');
    act(() => view.root.findByType(ServiceOutline).props.actions.update('service', { name: 'Next edit' }, 'name'));
    expect(view.root.findByType(ServiceOutline).props.nodes[0].name).toBe('Next edit');
  });

  it('makes JSON read-only while saving and unlocks it on success', async () => {
    act(() => button('JSON').props.onClick());
    let resolve!: (value: ServiceTreeView) => void;
    mocks.saveServiceTree.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    let pending!: Promise<void>;
    act(() => { pending = button('Save').props.onClick(); });
    const editor = view.root.findByType(ServiceJsonEditor);
    expect(editor.props.readOnly).toBe(true);
    act(() => editor.props.onChange('[{"id":"service","name":"Lost edit"}]'));
    await act(async () => { resolve({ ...tree, nodes: mocks.saveServiceTree.mock.calls[0][1], revision: 2 }); await pending; });
    expect(view.root.findByType(ServiceJsonEditor).props.readOnly).toBe(false);
    expect(view.root.findByType(ServiceJsonEditor).props.text).toContain('Submitted');
  });
});
