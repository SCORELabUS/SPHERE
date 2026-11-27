import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Iconify from '../../../core/components/iconify';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { useRouter } from '../../../core/hooks/useRouter';
import { useRecentItems } from '../../../core/hooks/useRecentItems';
import { useAuth } from '../../../auth/hooks/useAuth';
import { staggerContainer, fadeInUp, transitionDefault } from '../../../core/utils/motion-variants';
import {
  Organization,
  OrgMemberWithUser,
  OrganizationInvitation,
  OrgRole,
  OrgPricing,
  OrgCollection,
  OrgHierarchyNode,
  useOrganizationsApi,
  getPublicOrganization,
  getPublicOrgMembers,
  getPublicOrgHierarchy,
} from '../../api/organizationsApi';
import {
  OrgViewMode,
  ViewAsRequest,
  canPreviewOrganization,
  memberViewTarget,
  previewMembers,
  readViewAsRequest,
  resolveOrgView,
  viewAsKey,
  withViewAs,
} from '../../utils/view-as';
import { getPublicOrgPricings, getPublicOrgCollections } from '../../../pricing/api/pricingsApi';
import { useOrganization } from '../../hooks/useOrganization';
import PermissionsTab from '../../components/PermissionsTab';
import OrgAvatar from '../../../core/components/org-avatar';
import OrgDetailSkeleton from '../../../core/components/skeletons/org-detail-skeleton';
import { Tab, TreeNode, PER_PAGE } from './types';
import { ROLE_LABELS, ROLE_COLORS, TAB_META } from './constants';
import { useDebouncedValue } from './hooks';
import EditOrgModal from './components/EditOrgModal';
import OrgAvatarModal from './components/OrgAvatarModal';
import CreateSubOrgModal from './components/CreateSubOrgModal';
import AddMemberModal from './components/AddMemberModal';
import InviteModal from './components/InviteModal';
import OverviewTab from './components/OverviewTab';
import MembersTab from './components/MembersTab';
import OrganizationExitButton from './components/OrganizationExitButton';
import InvitationsTab from './components/InvitationsTab';
import PricingsTab from './components/PricingsTab';
import CollectionsTab from './components/CollectionsTab';
import HierarchyTab from './components/HierarchyTab';
import ChildRolesManager from './components/ChildRolesManager';
import ShareOrgMenu from './components/ShareOrgMenu';
import ServicesTab from './components/ServicesTab';
import ViewAsBanner from './components/ViewAsBanner';
import ViewAsMenu from './components/ViewAsMenu';
import { useBetaFeature } from '../../../beta/hooks/useBetaFeatures';
import BetaBadge from '../../../beta/components/beta-badge';
import ConfirmModal from '../../../core/components/confirm-modal';
import SettingsTab from './components/SettingsTab';

export default function OrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  // An owner or admin previewing their organization as a member or a visitor
  // keeps it in the URL, so a reload stays there and the browser's Back leaves.
  const [searchParams, setSearchParams] = useSearchParams();
  const viewAsRequest = readViewAsRequest(searchParams);
  const viewAsRequestKey = viewAsKey(viewAsRequest);
  const { authUser } = useAuth();
  const router = useRouter();
  const { addRecentOrganization } = useRecentItems();
  const { refresh: refreshMyOrganizations } = useOrganization();

  const [org, setOrg] = useState<Organization | null>(null);
  const [myRole, setMyRole] = useState<OrgRole | null>(null);
  const [viewMode, setViewMode] = useState<OrgViewMode>('self');
  /** The member previewed as, in a member preview; null for any plain member. */
  const [asMember, setAsMember] = useState<OrgMemberWithUser | null>(null);
  /** The page shows what people outside the organization see. */
  const isPublicView = viewMode === 'visitor' || viewMode === 'visitor-preview';
  /** An owner or admin is looking at someone else's view on purpose: nothing in it is theirs to act on. */
  const isPreview = viewMode === 'member-preview' || viewMode === 'visitor-preview';
  /** Who a member preview reads the organization as: a member's id, or `any` for any plain member. */
  const previewUserId = viewMode === 'member-preview' ? memberViewTarget(asMember) : undefined;
  const [members, setMembers] = useState<OrgMemberWithUser[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [pricings, setPricings] = useState<OrgPricing[]>([]);
  const [pricingsTotal, setPricingsTotal] = useState(0);
  const [pricingPage, setPricingPage] = useState(1);
  const [pricingSearch, setPricingSearch] = useState('');
  const [showOnlyUnlinked, setShowOnlyUnlinked] = useState(false);
  const [collections, setCollections] = useState<OrgCollection[]>([]);
  const [collectionsTotal, setCollectionsTotal] = useState(0);
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [allOrgCollections, setAllOrgCollections] = useState<OrgCollection[]>([]);
  const [accessibleCollectionNames, setAccessibleCollectionNames] = useState<Set<string> | null>(null);
  const [hierarchyTree, setHierarchyTree] = useState<TreeNode | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [createSubOrgModalOpen, setCreateSubOrgModalOpen] = useState(false);
  const [expandedTreeIds, setExpandedTreeIds] = useState<Set<string>>(new Set());

  const {
    getOrganization,
    getOrgMembers,
    listInvitations,
    getOrgPricings,
    getOrgCollections,
    getUserAccessiblePricings,
    getUserAccessibleCollections,
    getOrgHierarchy,
    getMemberViewPricings,
    getMemberViewCollections,
    getMemberViewHierarchy,
  } = useOrganizationsApi();

  const canManage = viewMode === 'self' && (myRole === 'OWNER' || myRole === 'ADMIN');
  /**
   * The role the page and its tabs are told about: none while it is public, as
   * for anyone outside, and the previewed member's own in a member preview.
   */
  const viewRole = isPublicView ? null : viewMode === 'member-preview' ? (asMember?.role ?? 'MEMBER') : myRole;
  /** Whose own rows the tabs mark and offer to leave: nobody's in a preview. */
  const tabsUserId = viewMode === 'self' ? authUser.user?.id : undefined;
  const previewCandidates = useMemo(() => previewMembers(members), [members]);
  const showServices = useBetaFeature('organization-services');
  // Leaving the Services tab with unsaved changes asks first, since they live in the tab.
  const servicesDirtyRef = useRef(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const leaveServicesFirst = useCallback((leave: () => void) => {
    if (activeTab === 'services' && servicesDirtyRef.current) setPendingLeave(() => leave);
    else leave();
  }, [activeTab]);
  const selectTab = useCallback((tab: Tab) => {
    if (tab !== activeTab) leaveServicesFirst(() => setActiveTab(tab));
  }, [activeTab, leaveServicesFirst]);
  const onServicesDirtyChange = useCallback((dirty: boolean) => {
    servicesDirtyRef.current = dirty;
  }, []);

  // A preview replaces the Services tab being edited, so it also asks before
  // dropping unsaved changes there.
  const viewAs = useCallback((request: ViewAsRequest) => {
    leaveServicesFirst(() => setSearchParams(params => withViewAs(params, request)));
  }, [leaveServicesFirst, setSearchParams]);
  const viewAsMember = useCallback((userId: string | null) => viewAs({ kind: 'member', userId }), [viewAs]);
  const viewAsVisitor = useCallback(() => viewAs({ kind: 'visitor' }), [viewAs]);
  const exitPreview = useCallback(() => viewAs(null), [viewAs]);

  const handleOrganizationExited = async () => {
    await refreshMyOrganizations();
    router.push('/');
  };

  /* ─── Data loading ─── */
  const loadSeqRef = useRef(0);
  const loadOrgData = useCallback(async () => {
    if (!organizationId) return;

    // Only the latest load is shown: switching the view or the organization
    // while one is still running must not leave the other one's data behind.
    const seq = ++loadSeqRef.current;
    const isStale = () => seq !== loadSeqRef.current;

    try {
      const isAuth = authUser.isAuthenticated && authUser.user?.id;

      let orgData: Organization;
      let membersData: OrgMemberWithUser[];

      if (isAuth) {
        orgData = await getOrganization(organizationId);
        membersData = await getOrgMembers(organizationId);
      } else {
        orgData = await getPublicOrganization(organizationId);
        membersData = await getPublicOrgMembers(organizationId);
      }

      const memberEntry = isAuth
        ? membersData.find(m => m.user.id === authUser.user?.id)
        : null;
      const userRole = memberEntry?.role ?? null;
      const { mode, asMember: previewed } = resolveOrgView(userRole, viewAsRequest, membersData);

      const showOrganization = () => {
        setOrg(orgData);
        setMembers(membersData);
        setMyRole(userRole);
        setViewMode(mode);
        setAsMember(previewed);
      };

      if (mode === 'member-preview') {
        // A member preview: the listings answered by the API as any plain member
        // (no permission of their own), or as that member with their own
        // permissions. Members get no invitations.
        const target = memberViewTarget(previewed);
        const [memberPricings, memberCollections] = await Promise.all([
          getMemberViewPricings(organizationId, target).catch(() => ({ pricings: [], total: 0 })),
          getMemberViewCollections(organizationId, target).catch(() => ({ collections: [], total: 0 })),
        ]);
        if (isStale()) return;
        showOrganization();
        setInvitations([]);
        setAllOrgCollections([]);
        setAccessibleCollectionNames(null);
        setPricings(memberPricings.pricings);
        setPricingsTotal(memberPricings.total);
        setCollections(memberCollections.collections);
        setCollectionsTotal(memberCollections.total);
      } else if (mode === 'visitor' || mode === 'visitor-preview') {
        // Public view: only what the public endpoints answer to a signed-out
        // caller, which is also what an owner or admin previewing it gets to see.
        const [publicPricings, publicCollections] = await Promise.all([
          getPublicOrgPricings(organizationId).catch(() => ({ pricings: [], total: 0 })),
          getPublicOrgCollections(organizationId).catch(() => ({ collections: [], total: 0 })),
        ]);
        if (isStale()) return;
        showOrganization();
        setInvitations([]);
        setAllOrgCollections([]);
        setAccessibleCollectionNames(null);
        setPricings(publicPricings.pricings);
        setPricingsTotal(publicPricings.total);
        setCollections(publicCollections.collections);
        setCollectionsTotal(publicCollections.total);
      } else {
        // Member view: full access logic
        const invitationsData =
          userRole === 'OWNER' || userRole === 'ADMIN' ? await listInvitations(organizationId) : [];

        if (userRole === 'MEMBER') {
          const [accessiblePricingsResult, , accessibleCollectionsResult, allOrgCollectionsResult] = await Promise.all([
            getUserAccessiblePricings().catch(() => ({ pricings: [], total: 0 })),
            getOrgPricings(organizationId).catch(() => ({ pricings: [], total: 0 })),
            getUserAccessibleCollections().catch(() => ({ collections: [], total: 0 })),
            getOrgCollections(organizationId).catch(() => ({ collections: [], total: 0 })),
          ]);
          if (isStale()) return;

          const pricingNames = new Set(
            accessiblePricingsResult.pricings
              .filter(p => p.organization.id === organizationId)
              .map(p => p.name)
          );
          const collectionNames = new Set(
            accessibleCollectionsResult.collections
              .filter(c => c.organization.id === organizationId)
              .map(c => c.name)
          );

          showOrganization();
          setInvitations(invitationsData);
          setPricingsTotal(pricingNames.size);

          setAllOrgCollections(allOrgCollectionsResult.collections);
          setAccessibleCollectionNames(collectionNames);
          setCollections(allOrgCollectionsResult.collections.filter(c => collectionNames.has(c.name)));
          setCollectionsTotal(collectionNames.size);
        } else {
          const pricingsData = await getOrgPricings(organizationId).catch(() => ({
            pricings: [],
            total: 0,
          }));
          const collectionsData = await getOrgCollections(organizationId).catch(() => ({
            collections: [],
            total: 0,
          }));
          if (isStale()) return;

          showOrganization();
          setInvitations(invitationsData);
          setAllOrgCollections([]);
          setAccessibleCollectionNames(null);
          setPricings(pricingsData.pricings);
          setPricingsTotal(pricingsData.total);
          setCollections(collectionsData.collections);
          setCollectionsTotal(collectionsData.total);
        }
      }
    } catch (err: any) {
      if (!isStale()) setError(err.message ?? 'Failed to load organization');
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, [organizationId, authUser.isAuthenticated, authUser.user?.id, viewAsRequestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Hierarchy tree ─── */
  /**
   * The branch arrives flat, in one request, and is nested here.
   *
   * It used to be walked node by node from the client — a fetch per child, per
   * ancestor and per sibling, in series — which cost dozens of round trips to
   * draw one tree.
   */
  const treeSeqRef = useRef(0);
  const buildHierarchyTree = useCallback(async () => {
    if (!org) return;

    const seq = ++treeSeqRef.current;
    let nodes: OrgHierarchyNode[];
    try {
      // A preview marks the nodes as they are for whoever it shows the page to:
      // a signed-out visitor, or the member, not the owner or admin looking.
      nodes =
        viewMode === 'visitor-preview'
          ? await getPublicOrgHierarchy(org.id)
          : previewUserId
            ? await getMemberViewHierarchy(org.id, previewUserId)
            : await getOrgHierarchy(org.id);
    } catch {
      return;
    }
    if (seq !== treeSeqRef.current) return;

    const byId = new Map<string, TreeNode>(
      nodes.map(node => [
        node.id,
        {
          id: node.id,
          displayName: node.displayName,
          name: node.name,
          avatar: node.avatar,
          isPersonal: node.isPersonal,
          _parentId: node._parentId,
          children: [],
          hasAccess: node.hasAccess,
        },
      ])
    );

    const ancestorIds = new Set<string>();
    let above = byId.get(org.id)?._parentId ?? null;
    while (above && !ancestorIds.has(above)) {
      ancestorIds.add(above);
      above = byId.get(above)?._parentId ?? null;
    }

    let root: TreeNode | null = null;
    for (const node of nodes) {
      const treeNode = byId.get(node.id)!;
      treeNode.isCurrent = node.id === org.id;
      treeNode.isAncestor = ancestorIds.has(node.id);

      const parent = node._parentId ? byId.get(node._parentId) : undefined;
      if (parent) {
        parent.children.push(treeNode);
      } else if (!root) {
        root = treeNode;
      }
    }

    setHierarchyTree(root ?? byId.get(org.id) ?? null);
  }, [org, viewMode, previewUserId, getOrgHierarchy, getMemberViewHierarchy]);

  // Built once a load is complete, so it is asked for in the view that load settled on.
  useEffect(() => {
    if (org && !isLoading) buildHierarchyTree();
  }, [org, myRole, isLoading, buildHierarchyTree]);

  const autoExpandedOrgIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hierarchyTree || !org) return;
    if (autoExpandedOrgIdRef.current === org.id) return;
    const ancestorIds: string[] = [];
    let node: TreeNode | null = hierarchyTree;
    while (node && node.id !== org.id) {
      ancestorIds.push(node.id);
      node = node.children.find(child => child.isAncestor || child.isCurrent) ?? null;
    }

    if (node) {
      autoExpandedOrgIdRef.current = org.id;
      setExpandedTreeIds(prev => {
        const next = new Set(prev);
        ancestorIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [org, hierarchyTree]);

  /* ─── Refresh helpers ─── */
  /**
   * A move or an ownership handover rewrites more than this page. "Your
   * organizations" reads from the shared context, which nothing here would
   * otherwise invalidate, so it has to be told as well or it keeps serving the
   * old hierarchy and the old roles until the next full page load.
   */
  const handleOrgChanged = useCallback(async () => {
    await loadOrgData();
    refreshMyOrganizations();
  }, [loadOrgData, refreshMyOrganizations]);

  const refreshMembers = useCallback(async () => {
    if (!org) return;
    try {
      const data = await getOrgMembers(org.id);
      setMembers(data);
    } catch {
      /* silently ignore */
    }
  }, [org, getOrgMembers]);

  const refreshInvitations = useCallback(async () => {
    if (!org) return;
    try {
      const data = await listInvitations(org.id);
      setInvitations(data);
    } catch {
      /* silently ignore */
    }
  }, [org, listInvitations]);

  /* ─── Paginated fetches ─── */
  const debouncedPricingSearch = useDebouncedValue(pricingSearch, 500);
  const debouncedCollectionSearch = useDebouncedValue(collectionSearch, 500);

  const fetchPricings = useCallback(
    async (page: number, search: string, signal?: AbortSignal) => {
      if (!org) return;

      try {
        const filters: Record<string, string> = {
          limit: String(PER_PAGE),
          offset: String((page - 1) * PER_PAGE),
        };
        if (search) filters.name = search;
        if (showOnlyUnlinked) filters.excludePricingsInCollection = 'true';
        const data = previewUserId
          ? await getMemberViewPricings(org.id, previewUserId, filters, signal)
          : isPublicView
            ? await getPublicOrgPricings(org.id, filters, signal)
            : await getOrgPricings(org.id, filters, signal);
        if (!signal?.aborted) {
          setPricings(data.pricings);
          setPricingsTotal(data.total);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!signal?.aborted) {
          setPricings([]);
          setPricingsTotal(0);
        }
      }
    },
    [org, isPublicView, previewUserId, getOrgPricings, getMemberViewPricings, showOnlyUnlinked]
  );

  const fetchCollections = useCallback(
    async (page: number, search: string) => {
      if (!org) return;

      if (previewUserId) {
        // Member preview: the collections answered as that member.
        try {
          const filters: Record<string, string> = {
            limit: String(PER_PAGE),
            offset: String((page - 1) * PER_PAGE),
          };
          if (search) filters.name = search;
          const data = await getMemberViewCollections(org.id, previewUserId, filters);
          setCollections(data.collections);
          setCollectionsTotal(data.total);
        } catch {
          /* silently ignore */
        }
      } else if (isPublicView) {
        // Public view: use public API
        try {
          const filters: Record<string, string> = {
            limit: String(PER_PAGE),
            offset: String((page - 1) * PER_PAGE),
          };
          if (search) filters.name = search;
          const data = await getPublicOrgCollections(org.id, filters);
          setCollections(data.collections);
          setCollectionsTotal(data.total);
        } catch {
          /* silently ignore */
        }
      } else if (myRole === 'MEMBER' && accessibleCollectionNames !== null) {
        let filtered = allOrgCollections.filter(c => accessibleCollectionNames.has(c.name));
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter(c => c.name.toLowerCase().includes(q));
        }
        setCollectionsTotal(search ? filtered.length : accessibleCollectionNames.size);
        const start = (page - 1) * PER_PAGE;
        setCollections(filtered.slice(start, start + PER_PAGE));
      } else {
        try {
          const filters: Record<string, string> = {
            limit: String(PER_PAGE),
            offset: String((page - 1) * PER_PAGE),
          };
          if (search) filters.name = search;
          const data = await getOrgCollections(org.id, filters);
          setCollections(data.collections);
          setCollectionsTotal(data.total);
        } catch {
          /* silently ignore */
        }
      }
    },
    [org, isPublicView, previewUserId, myRole, accessibleCollectionNames, allOrgCollections, getOrgCollections, getMemberViewCollections]
  );

  /* ─── Effects ─── */
  // Another organization, or the same one seen as a member or as a visitor, is
  // a different page: nothing of the previous one shows while it loads.
  useEffect(() => {
    if (authUser.isLoading) return;
    if (!organizationId) return;
    setIsLoading(true);
    setError(null);
    setHierarchyTree(null);
    setPricingPage(1);
    setCollectionPage(1);
    loadOrgData();
  }, [authUser.isLoading, organizationId, viewAsRequestKey]);

  useEffect(() => {
    if (activeTab === 'pricings' && org) {
      const controller = new AbortController();
      fetchPricings(pricingPage, debouncedPricingSearch, controller.signal);
      return () => controller.abort();
    }
  }, [activeTab, org, pricingPage, debouncedPricingSearch, showOnlyUnlinked]);

  useEffect(() => {
    if (activeTab === 'collections' && org)
      fetchCollections(collectionPage, debouncedCollectionSearch);
  }, [activeTab, org, collectionPage, debouncedCollectionSearch]);

  // Track visit for recent organizations
  useEffect(() => {
    if (!authUser.isAuthenticated || !org) return;
    addRecentOrganization({
      id: org.id,
      name: org.displayName || org.name,
      orgId: org.id,
      orgName: org.displayName || org.name,
    });
  }, [org?.id, authUser.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Tree toggle ─── */
  const handleTreeToggle = useCallback((id: string) => {
    setExpandedTreeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ─── Tabs ─── */
  const availableTabs = useMemo(() => {
    if (isPublicView) {
      return ['overview', 'members', 'pricings', 'collections', ...(showServices && org?.servicesPublic ? ['services' as const] : []), 'children'] as Tab[];
    }
    const tabs: Tab[] = [
      'overview',
      'members',
      'invitations',
      'pricings',
      'collections',
      ...(showServices ? ['services' as const] : []),
      'children',
    ];
    if (canManage) tabs.push('permissions', 'settings');
    return tabs;
  }, [isPublicView, canManage, showServices, org?.servicesPublic]);

  // Turning beta features off while on the Services tab leaves it.
  useEffect(() => {
    if (!availableTabs.includes(activeTab)) setActiveTab('overview');
  }, [availableTabs, activeTab]);

  /* ─── Loading / Error ─── */
  if (isLoading) return <OrgDetailSkeleton />;

  if (error || !org) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error ?? 'Organization not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* ═══ HERO HEADER ═══ */}
      <div className="relative overflow-hidden bg-linear-to-b from-tp-cream via-tp-cream-light to-tp-canvas">
        <div className="relative mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-10">
          <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
            <motion.button
              variants={fadeInUp}
              transition={transitionDefault}
              type="button"
              onClick={() => router.push(isPublicView ? '/' : '/me/orgs')}
              className="mb-5 inline-flex cursor-pointer items-center gap-1.5 text-sm text-tp-steel transition-colors hover:text-tp-ink"
            >
              <Iconify icon="mdi:arrow-left" width={16} />
              {isPublicView ? 'Home' : 'Organizations'}
            </motion.button>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <motion.div variants={fadeInUp} transition={transitionDefault} className="shrink-0">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => setAvatarModalOpen(true)}
                    title="Change the organization image"
                    className="group relative block cursor-pointer"
                  >
                    <OrgAvatar
                      name={org.displayName}
                      avatar={org.avatar}
                      avatarBgColor={org.avatarBgColor}
                      avatarFgColor={org.avatarFgColor}
                      size={80}
                      square
                      className="ring-2 ring-white shadow-elevation-2 sm:h-20 sm:w-20"
                    />
                    <span className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      <Iconify icon="mdi:camera-outline" width={22} className="text-white" />
                    </span>
                    {/* The dimmed overlay above only appears on hover, which leaves
                        nothing to find for anyone who never thinks to point at the
                        image. This badge is the standing affordance. */}
                    <span className="absolute -right-1.5 -bottom-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-tp-hairline bg-tp-canvas text-tp-slate shadow-elevation-2 transition-colors group-hover:border-tp-primary group-hover:bg-tp-primary group-hover:text-tp-on-primary">
                      <Iconify icon="mdi:camera-outline" width={14} />
                    </span>
                  </button>
                ) : (
                  <OrgAvatar
                    name={org.displayName}
                    avatar={org.avatar}
                    avatarBgColor={org.avatarBgColor}
                    avatarFgColor={org.avatarFgColor}
                    size={80}
                    square
                    className="ring-2 ring-white shadow-elevation-2 sm:h-20 sm:w-20"
                  />
                )}
              </motion.div>

              <div className="min-w-0 flex-1">
                <motion.div
                  variants={fadeInUp}
                  transition={transitionDefault}
                  className="flex flex-wrap items-center gap-3"
                >
                  <h1 className="font-display text-2xl text-tp-ink sm:text-3xl">
                    {org.displayName}
                  </h1>
                  {viewRole && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ROLE_COLORS[viewRole]}`}
                    >
                      {ROLE_LABELS[viewRole]}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2 sm:ml-0">
                    <ShareOrgMenu org={org} />
                    {viewMode === 'self' && canPreviewOrganization(myRole) && (
                      <ViewAsMenu onViewAsMember={() => viewAsMember(null)} onViewAsVisitor={viewAsVisitor} />
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setEditModalOpen(true)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-slate transition-colors hover:border-tp-hairline hover:bg-tp-surface hover:text-tp-ink"
                      >
                        <Iconify icon="mdi:pencil-outline" width={15} />
                        Edit
                      </button>
                    )}
                    {viewMode === 'self' && (
                      <OrganizationExitButton
                        orgId={org.id}
                        isPersonal={org.isPersonal}
                        members={members}
                        currentUserId={authUser.user?.id}
                        onExited={handleOrganizationExited}
                      />
                    )}
                  </div>
                </motion.div>
                <motion.p
                  variants={fadeInUp}
                  transition={transitionDefault}
                  className="mt-0.5 font-mono text-sm text-tp-steel"
                >
                  @{org.name}
                </motion.p>
                {org.description && (
                  <motion.p
                    variants={fadeInUp}
                    transition={transitionDefault}
                    className="mt-2 max-w-2xl text-sm leading-relaxed text-tp-slate"
                  >
                    {org.description}
                  </motion.p>
                )}
              </div>
            </div>

            <motion.div
              variants={fadeInUp}
              transition={transitionDefault}
              className="mt-6 flex flex-wrap gap-x-5 gap-y-2 sm:gap-x-6"
            >
              {[
                { label: 'Members', value: members.length, icon: 'mdi:account-group-outline' },
                {
                  label: 'Sub-orgs',
                  value: org.subOrganizations?.length ?? 0,
                  icon: 'mdi:graph-outline',
                },
                { label: 'Pricings', value: pricingsTotal, icon: 'mdi:tag-outline', iconComponent: FaFileInvoiceDollar },
                { label: 'Collections', value: collectionsTotal, icon: 'mdi:folder-outline' },
                ...(!isPublicView ? [{ label: 'Invitations', value: invitations.length, icon: 'mdi:link-variant' }] : []),
              ].map(stat => (
                <div key={stat.label} className="flex items-center gap-1.5">
                  {'iconComponent' in stat && stat.iconComponent ? (
                    <stat.iconComponent size={14} className="text-tp-steel" />
                  ) : (
                    <Iconify icon={stat.icon} width={14} className="text-tp-steel" />
                  )}
                  <span className="text-sm font-semibold text-tp-ink">{stat.value}</span>
                  <span className="text-xs text-tp-steel">{stat.label}</span>
                </div>
              ))}
              {org.createdAt && (
                <div className="flex items-center gap-2">
                  <Iconify icon="mdi:calendar-outline" width={15} className="text-tp-ink" />
                  <span className="text-xs text-tp-steel">
                    Created{' '}
                    {new Date(org.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              )}
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* ═══ TAB NAVIGATION ═══ */}
      <div className="sticky top-14 z-30 border-b border-tp-hairline bg-tp-canvas/80 backdrop-blur-xl">
        {isPreview && (
          <ViewAsBanner
            kind={viewMode === 'member-preview' ? 'member' : 'visitor'}
            orgName={org.displayName}
            members={previewCandidates}
            asMember={asMember}
            onViewAsMember={viewAsMember}
            onViewAsVisitor={viewAsVisitor}
            onExit={exitPreview}
          />
        )}
        <div className="mx-auto max-w-5xl px-4 md:px-8">
          <div className="py-2 lg:hidden">
            <div className="relative">
              <select
                value={activeTab}
                onChange={e => selectTab(e.target.value as Tab)}
                className="w-full appearance-none rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 pr-8 text-sm font-medium text-tp-ink transition-colors focus:border-tp-primary focus:outline-none"
              >
                {availableTabs.map(tab => (
                  <option key={tab} value={tab}>
                    {TAB_META[tab].beta ? `${TAB_META[tab].label} (Beta)` : TAB_META[tab].label}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tp-steel"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Every tab fits from lg on (the dropdown covers narrower screens); the bar never shows a scrollbar. */}
          <nav
            className="hidden gap-1 overflow-x-auto py-1 [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden"
            role="tablist"
          >
            {availableTabs.map(tab => {
              const meta = TAB_META[tab];
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => selectTab(tab)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === tab
                      ? 'bg-tp-primary/8 text-tp-primary'
                      : 'text-tp-steel hover:bg-tp-surface hover:text-tp-ink'
                  }`}
                >
                  {meta.iconComponent ? (
                    <meta.iconComponent size={16} />
                  ) : (
                    <Iconify icon={meta.icon} width={16} />
                  )}
                  {meta.label}
                  {meta.beta && <BetaBadge />}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <OverviewTab
              org={org}
              members={members}
              pricingsTotal={pricingsTotal}
              collectionsTotal={collectionsTotal}
              invitations={isPublicView ? [] : invitations}
              isPublicView={isPublicView}
            />
          )}

          {activeTab === 'members' && (
            <MembersTab
              orgId={org.id}
              members={members}
              canManage={canManage}
              currentUserId={tabsUserId}
              managerRole={viewRole}
              onRefresh={refreshMembers}
              onOwnershipTransferred={handleOrgChanged}
              onAddMember={() => setAddMemberModalOpen(true)}
              onLeave={handleOrganizationExited}
              isPersonal={org.isPersonal}
              isPublicView={isPublicView}
            />
          )}

          {!isPublicView && activeTab === 'invitations' && (
            <InvitationsTab
              orgId={org.id}
              invitations={invitations}
              canManage={canManage}
              onRefresh={refreshInvitations}
              onOpenInvite={() => setInviteModalOpen(true)}
            />
          )}

          {activeTab === 'pricings' && (
            <PricingsTab
              pricings={pricings}
              pricingsTotal={pricingsTotal}
              pricingPage={pricingPage}
              pricingSearch={pricingSearch}
              showOnlyUnlinked={showOnlyUnlinked}
              orgId={organizationId ?? ''}
              myRole={viewRole}
              isPublicView={isPublicView}
              readOnly={isPreview}
              onPageChange={setPricingPage}
              onSearchChange={setPricingSearch}
              onToggleUnlinked={setShowOnlyUnlinked}
              onPricingAdded={() => fetchPricings(pricingPage, debouncedPricingSearch)}
            />
          )}

          {activeTab === 'collections' && (
            <CollectionsTab
              collections={collections}
              collectionsTotal={collectionsTotal}
              collectionPage={collectionPage}
              collectionSearch={collectionSearch}
              orgId={organizationId ?? ''}
              myRole={viewRole}
              isPublicView={isPublicView}
              readOnly={isPreview}
              onPageChange={setCollectionPage}
              onSearchChange={setCollectionSearch}
            />
          )}

          {showServices && (!isPublicView || org.servicesPublic) && activeTab === 'services' && (
            <ServicesTab
              // Another member is another tree, read from scratch.
              key={isPublicView ? 'visitor' : previewUserId ?? 'self'}
              org={org}
              onDirtyChange={onServicesDirtyChange}
              viewAsUserId={previewUserId}
              publicView={isPublicView}
            />
          )}

          {canManage && activeTab === 'settings' && <SettingsTab org={org} onSaved={setOrg} />}

          {activeTab === 'children' && (
            <HierarchyTab
              org={org}
              canManage={canManage}
              hierarchyTree={hierarchyTree}
              expandedTreeIds={expandedTreeIds}
              onToggle={handleTreeToggle}
              onNavigate={id => router.push(`/orgs/${id}`)}
              onCreateSubOrg={() => setCreateSubOrgModalOpen(true)}
              onMoved={handleOrgChanged}
            />
          )}

          {!isPublicView && activeTab === 'permissions' && organizationId && (
            <motion.div
              key="permissions"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={transitionDefault}
            >
              <PermissionsTab organizationId={organizationId} canManage={canManage} />
              {canManage && myRole && (org.subOrganizations?.length ?? 0) > 0 && (
                <ChildRolesManager
                  parentOrgId={org.id}
                  organizations={org.subOrganizations ?? []}
                  currentUserId={authUser.user?.id}
                  onNavigate={id => router.push(`/orgs/${id}`)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ MODALS ═══ */}
      <AnimatePresence>
        {pendingLeave && (
          <ConfirmModal
            message="Leave the services without saving your changes?"
            confirmLabel="Leave"
            danger
            onCancel={() => setPendingLeave(null)}
            onConfirm={() => {
              servicesDirtyRef.current = false;
              setPendingLeave(null);
              pendingLeave();
            }}
          />
        )}
        {editModalOpen && org && (
          <EditOrgModal
            org={org}
            onClose={() => setEditModalOpen(false)}
            onSaved={updated => {
              setOrg(updated);
              setEditModalOpen(false);
            }}
          />
        )}
        {avatarModalOpen && org && (
          <OrgAvatarModal
            org={org}
            onClose={() => setAvatarModalOpen(false)}
            onSaved={updated => {
              // Only the avatar fields are taken from the response: the avatar
              // endpoints return the organization on its own, without the child
              // organizations this page loaded separately, and replacing the
              // whole object would drop them until the next reload.
              setOrg(current =>
                current
                  ? {
                      ...current,
                      avatar: updated.avatar,
                      avatarBgColor: updated.avatarBgColor,
                      avatarFgColor: updated.avatarFgColor,
                    }
                  : updated
              );
              // The "Your organizations" list lives in a shared context that is
              // only loaded once, so it has to be told the avatar changed.
              refreshMyOrganizations();
            }}
          />
        )}
        {addMemberModalOpen && org && (
          <AddMemberModal
            orgId={org.id}
            onClose={() => setAddMemberModalOpen(false)}
            onAdded={refreshMembers}
          />
        )}
        {inviteModalOpen && org && (
          <InviteModal
            orgId={org.id}
            invitations={invitations}
            onClose={() => setInviteModalOpen(false)}
            onRefresh={refreshInvitations}
          />
        )}
        {createSubOrgModalOpen && org && (
          <CreateSubOrgModal
            parentId={org.id}
            onClose={() => setCreateSubOrgModalOpen(false)}
            onCreated={loadOrgData}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
