import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationDetailPage from './index';
import OverviewTab from './components/OverviewTab';
import MembersTab from './components/MembersTab';
import PricingsTab from './components/PricingsTab';
import CollectionsTab from './components/CollectionsTab';
import HierarchyTab from './components/HierarchyTab';
import ServicesTab from './components/ServicesTab';
import ViewAsMenu from './components/ViewAsMenu';
import ViewAsBanner from './components/ViewAsBanner';
import ConfirmModal from '../../../core/components/confirm-modal';

const mocks = vi.hoisted(() => ({
  search: '',
  /** What the browser does to the URL (Back, a typed address), outside the page. */
  navigate: { current: (() => {}) as (search: string) => void },
  setSearchParams: vi.fn(),
  auth: {
    isLoading: false,
    isAuthenticated: true,
    user: { id: 'owner', role: 'USER' } as { id: string; role: string } | null,
  },
  api: {
    getOrganization: vi.fn(),
    getOrgMembers: vi.fn(),
    listInvitations: vi.fn(),
    getOrgPricings: vi.fn(),
    getOrgCollections: vi.fn(),
    getUserAccessiblePricings: vi.fn(),
    getUserAccessibleCollections: vi.fn(),
    getOrgHierarchy: vi.fn(),
    getMemberViewPricings: vi.fn(),
    getMemberViewCollections: vi.fn(),
    getMemberViewHierarchy: vi.fn(),
  },
  getPublicOrganization: vi.fn(),
  getPublicOrgMembers: vi.fn(),
  getPublicOrgHierarchy: vi.fn(),
  getPublicOrgPricings: vi.fn(),
  getPublicOrgCollections: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const React = await import('react');
  return {
    useParams: () => ({ organizationId: 'org' }),
    useSearchParams: () => {
      const [params, setParams] = React.useState(() => new URLSearchParams(mocks.search));
      const set = (next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) => {
        const value = typeof next === 'function' ? next(params) : next;
        mocks.setSearchParams(value.toString());
        setParams(value);
      };
      mocks.navigate.current = search => setParams(new URLSearchParams(search));
      return [params, set];
    },
  };
});
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const tags = new Map<string, unknown>();
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        if (!tags.has(tag)) {
          tags.set(
            tag,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            ({ initial, animate, exit, variants, transition, whileHover, whileTap, ...rest }: any) =>
              React.createElement(tag, rest)
          );
        }
        return tags.get(tag);
      },
    }
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});
vi.mock('../../../auth/hooks/useAuth', () => ({ useAuth: () => ({ authUser: mocks.auth }) }));
vi.mock('../../../core/hooks/useRouter', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../core/hooks/useRecentItems', () => ({
  useRecentItems: () => ({ addRecentOrganization: vi.fn() }),
}));
vi.mock('../../hooks/useOrganization', () => ({ useOrganization: () => ({ refresh: vi.fn() }) }));
vi.mock('../../api/organizationsApi', () => ({
  useOrganizationsApi: () => mocks.api,
  getPublicOrganization: mocks.getPublicOrganization,
  getPublicOrgMembers: mocks.getPublicOrgMembers,
  getPublicOrgHierarchy: mocks.getPublicOrgHierarchy,
}));
vi.mock('../../../pricing/api/pricingsApi', () => ({
  getPublicOrgPricings: mocks.getPublicOrgPricings,
  getPublicOrgCollections: mocks.getPublicOrgCollections,
}));
vi.mock('../../../beta/hooks/useBetaFeatures', () => ({ useBetaFeature: () => true }));
vi.mock('../../../beta/components/beta-badge', () => ({ default: () => null }));
vi.mock('../../../core/components/iconify', () => ({ default: () => null }));
vi.mock('../../../core/components/org-avatar', () => ({ default: () => null }));
vi.mock('../../../core/components/skeletons/org-detail-skeleton', () => ({ default: () => null }));
vi.mock('../../../core/components/confirm-modal', () => ({ default: () => null }));
vi.mock('../../components/PermissionsTab', () => ({ default: () => null }));
// The menu opens in a portal, which this renderer has no document for; its props are what matter here.
vi.mock('./components/ViewAsMenu', () => ({ default: () => null }));
vi.mock('./components/OverviewTab', () => ({ default: () => null }));
vi.mock('./components/MembersTab', () => ({ default: () => null }));
vi.mock('./components/InvitationsTab', () => ({ default: () => null }));
vi.mock('./components/PricingsTab', () => ({ default: () => null }));
vi.mock('./components/CollectionsTab', () => ({ default: () => null }));
vi.mock('./components/HierarchyTab', () => ({ default: () => null }));
vi.mock('./components/ServicesTab', () => ({ default: () => null }));
vi.mock('./components/ChildRolesManager', () => ({ default: () => null }));
vi.mock('./components/ShareOrgMenu', () => ({ default: () => null }));
vi.mock('./components/OrganizationExitButton', () => ({ default: () => null }));
vi.mock('./components/EditOrgModal', () => ({ default: () => null }));
vi.mock('./components/OrgAvatarModal', () => ({ default: () => null }));
vi.mock('./components/CreateSubOrgModal', () => ({ default: () => null }));
vi.mock('./components/AddMemberModal', () => ({ default: () => null }));
vi.mock('./components/InviteModal', () => ({ default: () => null }));

const org = {
  id: 'org',
  name: 'acme',
  displayName: 'Acme',
  description: null,
  avatar: null,
  isPersonal: false,
  _parentId: null,
  ancestors: [],
  subOrganizations: [],
};
const member = (id: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') => ({
  id: `membership-${id}`,
  role,
  joinedAt: '',
  user: { id, username: id, email: `${id}@example.com`, avatar: null },
});
const node = (hasAccess: boolean) => ({
  id: 'org', name: 'acme', displayName: 'Acme', avatar: null, isPersonal: false, _parentId: null, hasAccess,
});
const publicPricing = { id: 'public', name: 'Public', slug: 'public', private: false };
const privatePricing = { id: 'private', name: 'Private', slug: 'private', private: true };
const grantedPricing = { id: 'granted', name: 'Granted', slug: 'granted', private: true };

const text = (item: ReactTestInstance): string =>
  item.children.map(child => (typeof child === 'string' ? child : text(child))).join('');
/** Lets every pending request and the renders they cause settle. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('Organization page seen as a member or a visitor', () => {
  let view: ReactTestRenderer;

  const buttons = () => view.root.findAllByType('button');
  const menu = () => view.root.findAllByType(ViewAsMenu)[0];
  const banner = () => view.root.findAllByType(ViewAsBanner)[0];
  const editButton = () => buttons().find(item => text(item) === 'Edit');
  const tabs = () => buttons().filter(item => item.props.role === 'tab').map(text);
  const roleBadge = () => view.root.findAllByType('span').find(item => ['Owner', 'Admin', 'Member'].includes(text(item)));
  const openTab = (label: string) =>
    act(() => buttons().find(item => item.props.role === 'tab' && text(item) === label)!.props.onClick());

  async function render() {
    await act(async () => { view = create(<OrganizationDetailPage />); });
    await settle();
    await settle();
  }
  async function act_(action: () => void) {
    await act(async () => action());
    await settle();
    await settle();
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.search = '';
    mocks.auth.isAuthenticated = true;
    mocks.auth.user = { id: 'owner', role: 'USER' };
    const members = [member('owner', 'OWNER'), member('zed', 'MEMBER'), member('colleague', 'MEMBER')];
    mocks.api.getOrganization.mockResolvedValue(org);
    mocks.api.getOrgMembers.mockResolvedValue(members);
    mocks.api.listInvitations.mockResolvedValue([{ id: 'invitation' }]);
    mocks.api.getOrgPricings.mockResolvedValue({ pricings: [publicPricing, privatePricing, grantedPricing], total: 3 });
    mocks.api.getOrgCollections.mockResolvedValue({ collections: [], total: 0 });
    mocks.api.getUserAccessiblePricings.mockResolvedValue({ pricings: [], total: 0 });
    mocks.api.getUserAccessibleCollections.mockResolvedValue({ collections: [], total: 0 });
    mocks.api.getOrgHierarchy.mockResolvedValue([node(true)]);
    mocks.api.getMemberViewPricings.mockResolvedValue({ pricings: [publicPricing, grantedPricing], total: 2 });
    mocks.api.getMemberViewCollections.mockResolvedValue({ collections: [], total: 0 });
    mocks.api.getMemberViewHierarchy.mockResolvedValue([node(true)]);
    mocks.getPublicOrganization.mockResolvedValue(org);
    mocks.getPublicOrgMembers.mockResolvedValue(members);
    mocks.getPublicOrgPricings.mockResolvedValue({ pricings: [publicPricing], total: 1 });
    mocks.getPublicOrgCollections.mockResolvedValue({ collections: [], total: 0 });
    mocks.getPublicOrgHierarchy.mockResolvedValue([node(false)]);
  });

  afterEach(() => {
    act(() => view.unmount());
  });

  describe('who gets it', () => {
    it.each(['OWNER', 'ADMIN'] as const)('offers "View as" to an %s', async role => {
      mocks.api.getOrgMembers.mockResolvedValue([member('owner', role), member('zed', 'MEMBER'), member('colleague', 'MEMBER')]);
      await render();

      expect(menu()).toBeDefined();
      expect(banner()).toBeUndefined();
    });

    it.each(['view=member&as=zed', 'view=visitor'])('gives a plain member their own view, even with ?%s', async search => {
      mocks.search = search;
      mocks.auth.user = { id: 'colleague', role: 'USER' };
      await render();

      expect(menu()).toBeUndefined();
      expect(banner()).toBeUndefined();
      expect(view.root.findByType(OverviewTab).props.isPublicView).toBe(false);
      expect(mocks.api.getMemberViewPricings).not.toHaveBeenCalled();
      expect(mocks.getPublicOrgPricings).not.toHaveBeenCalled();
      expect(mocks.api.getOrgHierarchy).toHaveBeenCalledWith('org');
    });

    it.each([
      ['a signed-in non-member', true],
      ['a signed-out visitor', false],
    ])('changes nothing for %s', async (_who, signedIn) => {
      mocks.search = 'view=member&as=zed';
      mocks.auth.isAuthenticated = signedIn;
      mocks.auth.user = signedIn ? { id: 'stranger', role: 'USER' } : null;
      await render();

      expect(view.root.findByType(OverviewTab).props.isPublicView).toBe(true);
      expect(banner()).toBeUndefined();
      expect(menu()).toBeUndefined();
      expect(mocks.api.getMemberViewPricings).not.toHaveBeenCalled();
      expect(mocks.getPublicOrgHierarchy).not.toHaveBeenCalled();
    });

    it('previews as any member even when the organization has no plain members', async () => {
      mocks.search = 'view=member';
      mocks.api.getOrgMembers.mockResolvedValue([member('owner', 'OWNER'), member('admin', 'ADMIN')]);
      await render();

      expect(banner().props).toMatchObject({ kind: 'member', asMember: null, members: [] });
      expect(mocks.api.getMemberViewPricings).toHaveBeenCalledWith('org', 'any');
      expect(text(roleBadge()!)).toBe('Member');
    });
  });

  describe('as a member', () => {
    it('switches from the menu to what any member sees, answered by the API as one', async () => {
      await render();
      expect(view.root.findByType(OverviewTab).props).toMatchObject({ pricingsTotal: 3 });

      await act_(() => menu().props.onViewAsMember());

      expect(mocks.setSearchParams).toHaveBeenLastCalledWith('view=member');
      expect(mocks.api.getMemberViewPricings).toHaveBeenCalledWith('org', 'any');
      expect(mocks.api.getMemberViewCollections).toHaveBeenCalledWith('org', 'any');
      expect(mocks.api.getMemberViewHierarchy).toHaveBeenCalledWith('org', 'any');
      expect(view.root.findByType(OverviewTab).props).toMatchObject({ isPublicView: false, pricingsTotal: 2, invitations: [] });
      expect(banner().props).toMatchObject({ kind: 'member', orgName: 'Acme', asMember: null });
      // Plain members can also be picked one by one, by username.
      expect(banner().props.members.map((item: any) => item.user.id)).toEqual(['colleague', 'zed']);
      expect(menu()).toBeUndefined();
      expect(editButton()).toBeUndefined();
      expect(text(roleBadge()!)).toBe('Member');
      // A member's tabs: no Permissions, Services (beta) included.
      expect(tabs()).toEqual(['Overview', 'Members', 'Invitations', 'Pricings', 'Collections', 'Services', 'Hierarchy']);
    });

    it('opened with ?view=member&as=..., never reads the owner\'s own listings', async () => {
      mocks.search = 'view=member&as=zed';
      await render();

      expect(mocks.api.listInvitations).not.toHaveBeenCalled();
      expect(mocks.api.getOrgPricings).not.toHaveBeenCalled();
      expect(mocks.api.getOrgCollections).not.toHaveBeenCalled();
      expect(mocks.api.getOrgHierarchy).not.toHaveBeenCalled();
      expect(mocks.getPublicOrgPricings).not.toHaveBeenCalled();
      expect(mocks.api.getMemberViewPricings).toHaveBeenCalledWith('org', 'zed');

      openTab('Members');
      expect(view.root.findByType(MembersTab).props).toMatchObject({
        isPublicView: false,
        canManage: false,
        currentUserId: undefined,
        managerRole: 'MEMBER',
      });

      openTab('Pricings');
      await settle();
      expect(view.root.findByType(PricingsTab).props).toMatchObject({ readOnly: true, isPublicView: false, myRole: 'MEMBER' });
      expect(mocks.api.getMemberViewPricings).toHaveBeenLastCalledWith('org', 'zed', expect.objectContaining({ limit: '10', offset: '0' }), expect.anything());

      openTab('Collections');
      await settle();
      expect(view.root.findByType(CollectionsTab).props).toMatchObject({ readOnly: true, myRole: 'MEMBER' });
      expect(mocks.api.getMemberViewCollections).toHaveBeenLastCalledWith('org', 'zed', expect.objectContaining({ limit: '10' }));

      openTab('Services');
      expect(view.root.findByType(ServicesTab).props.viewAsUserId).toBe('zed');

      openTab('Hierarchy');
      expect(view.root.findByType(HierarchyTab).props.canManage).toBe(false);
    });

    it('previews as any member when the one asked for is not a plain member', async () => {
      mocks.search = 'view=member&as=owner';
      await render();

      expect(banner().props.asMember).toBeNull();
      expect(mocks.api.getMemberViewPricings).toHaveBeenCalledWith('org', 'any');
    });

    it('picks a member, goes back to any member and switches to the visitor view from the banner', async () => {
      mocks.search = 'view=member';
      await render();

      await act_(() => banner().props.onViewAsMember('zed'));
      expect(mocks.setSearchParams).toHaveBeenLastCalledWith('view=member&as=zed');
      expect(mocks.api.getMemberViewPricings).toHaveBeenLastCalledWith('org', 'zed');
      expect(banner().props.asMember.user.id).toBe('zed');

      await act_(() => banner().props.onViewAsMember(null));
      expect(mocks.setSearchParams).toHaveBeenLastCalledWith('view=member');
      expect(mocks.api.getMemberViewPricings).toHaveBeenLastCalledWith('org', 'any');
      expect(banner().props.asMember).toBeNull();

      await act_(() => banner().props.onViewAsVisitor());
      expect(mocks.setSearchParams).toHaveBeenLastCalledWith('view=visitor');
      expect(banner().props.kind).toBe('visitor');
      expect(view.root.findByType(OverviewTab).props).toMatchObject({ isPublicView: true, pricingsTotal: 1 });
    });
  });

  describe('as a visitor', () => {
    it('switches from the menu to what a signed-out visitor gets', async () => {
      await render();

      await act_(() => menu().props.onViewAsVisitor());

      expect(mocks.setSearchParams).toHaveBeenLastCalledWith('view=visitor');
      expect(mocks.getPublicOrgPricings).toHaveBeenCalledWith('org');
      expect(mocks.getPublicOrgCollections).toHaveBeenCalledWith('org');
      expect(view.root.findByType(OverviewTab).props).toMatchObject({ isPublicView: true, pricingsTotal: 1, invitations: [] });
      expect(banner().props.kind).toBe('visitor');
      expect(roleBadge()).toBeUndefined();
      expect(editButton()).toBeUndefined();
      expect(tabs()).toEqual(['Overview', 'Members', 'Pricings', 'Collections', 'Hierarchy']);
    });

    it('opened with ?view=visitor, shows nothing a visitor would not see', async () => {
      mocks.search = 'view=visitor';
      await render();

      expect(mocks.api.listInvitations).not.toHaveBeenCalled();
      expect(mocks.api.getOrgPricings).not.toHaveBeenCalled();
      expect(mocks.api.getOrgHierarchy).not.toHaveBeenCalled();
      expect(mocks.getPublicOrgHierarchy).toHaveBeenCalledWith('org');

      openTab('Members');
      expect(view.root.findByType(MembersTab).props).toMatchObject({
        isPublicView: true,
        canManage: false,
        currentUserId: undefined,
        managerRole: null,
      });
      openTab('Hierarchy');
      expect(view.root.findByType(HierarchyTab).props.hierarchyTree).toMatchObject({ hasAccess: false, isCurrent: true });
    });
  });

  it('goes back to the owner\'s own view from the banner', async () => {
    mocks.search = 'view=member&as=zed';
    await render();
    openTab('Members');

    await act_(() => banner().props.onExit());

    expect(mocks.setSearchParams).toHaveBeenLastCalledWith('');
    expect(banner()).toBeUndefined();
    expect(mocks.api.listInvitations).toHaveBeenCalledWith('org');
    expect(view.root.findByType(MembersTab).props).toMatchObject({
      canManage: true,
      currentUserId: 'owner',
      managerRole: 'OWNER',
    });
    expect(menu()).toBeDefined();
    expect(tabs()).toContain('Permissions');
  });

  it('asks before dropping unsaved services changes', async () => {
    await render();
    openTab('Services');
    act(() => view.root.findByType(ServicesTab).props.onDirtyChange(true));

    act(() => menu().props.onViewAsMember());
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
    act(() => view.root.findByType(ConfirmModal).props.onCancel());
    expect(view.root.findAllByType(ConfirmModal)).toHaveLength(0);
    expect(mocks.setSearchParams).not.toHaveBeenCalled();

    act(() => menu().props.onViewAsVisitor());
    await act_(() => view.root.findByType(ConfirmModal).props.onConfirm());
    expect(mocks.setSearchParams).toHaveBeenLastCalledWith('view=visitor');
    expect(banner()).toBeDefined();
  });

  it('never shows a load that finishes after the view changed', async () => {
    let finishOwnLoad!: (value: unknown) => void;
    mocks.api.getOrgPricings.mockReturnValueOnce(new Promise(resolve => { finishOwnLoad = resolve; }));
    await act(async () => { view = create(<OrganizationDetailPage />); });
    await settle();

    // The browser's Back/Forward changes the view while the owner's own view is still loading.
    await act_(() => mocks.navigate.current('view=member&as=zed'));
    expect(view.root.findByType(OverviewTab).props).toMatchObject({ pricingsTotal: 2 });

    await act_(() => finishOwnLoad({ pricings: [publicPricing, privatePricing, grantedPricing], total: 3 }));
    expect(view.root.findByType(OverviewTab).props).toMatchObject({ pricingsTotal: 2 });
    expect(banner().props.kind).toBe('member');
  });
});
