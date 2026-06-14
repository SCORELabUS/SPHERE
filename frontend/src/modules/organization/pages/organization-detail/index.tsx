import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Iconify from '../../../core/components/iconify';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { useRouter } from '../../../core/hooks/useRouter';
import { useRecentItems } from '../../../core/hooks/useRecentItems';
import { useAuth } from '../../../auth/hooks/useAuth';
import customConfirm from '../../../core/utils/custom-confirm';
import customAlert from '../../../core/utils/custom-alert';
import { staggerContainer, fadeInUp, transitionDefault } from '../../../core/utils/motion-variants';
import {
  Organization,
  OrgMemberWithUser,
  OrganizationInvitation,
  OrgRole,
  OrgPricing,
  OrgCollection,
  useOrganizationsApi,
  getPublicOrganization,
  getPublicOrgMembers,
} from '../../api/organizationsApi';
import { getPublicOrgPricings, getPublicOrgCollections } from '../../../pricing/api/pricingsApi';
import PermissionsTab from '../../components/PermissionsTab';
import OrgAvatar from '../../../core/components/org-avatar';
import OrgDetailSkeleton from '../../../core/components/skeletons/org-detail-skeleton';
import { Tab, TreeNode, PER_PAGE } from './types';
import { ROLE_LABELS, ROLE_COLORS, TAB_META } from './constants';
import { useDebouncedValue } from './hooks';
import EditOrgModal from './components/EditOrgModal';
import CreateSubOrgModal from './components/CreateSubOrgModal';
import AddMemberModal from './components/AddMemberModal';
import InviteModal from './components/InviteModal';
import OverviewTab from './components/OverviewTab';
import MembersTab from './components/MembersTab';
import InvitationsTab from './components/InvitationsTab';
import PricingsTab from './components/PricingsTab';
import CollectionsTab from './components/CollectionsTab';
import HierarchyTab from './components/HierarchyTab';

export default function OrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { authUser } = useAuth();
  const router = useRouter();
  const { addRecentOrganization } = useRecentItems();

  const [org, setOrg] = useState<Organization | null>(null);
  const [myRole, setMyRole] = useState<OrgRole | null>(null);
  const [isPublicView, setIsPublicView] = useState(false);
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
  const [childAccessMap, setChildAccessMap] = useState<Record<string, boolean>>({});
  const [hierarchyTree, setHierarchyTree] = useState<TreeNode | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editModalOpen, setEditModalOpen] = useState(false);
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
    removeMember,
  } = useOrganizationsApi();

  const canManage = !isPublicView && (myRole === 'OWNER' || myRole === 'ADMIN');

  const handleLeaveOrg = useCallback(() => {
    if (!authUser.user?.id || !organizationId) return;
    customConfirm(
      'Are you sure you want to leave this organization? You will lose access to all its resources.',
      { danger: true }
    )
      .then(() =>
        removeMember(organizationId, authUser.user!.id)
          .then(() => router.push('/'))
          .catch((err: Error) => customAlert(err.message))
      )
      .catch(() => {});
  }, [authUser.user?.id, organizationId, removeMember, router]);

  /* ─── Data loading ─── */
  const loadOrgData = useCallback(async () => {
    if (!organizationId) return;

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

      setOrg(orgData);
      setMembers(membersData);

      const memberEntry = isAuth
        ? membersData.find(m => m.user.id === authUser.user?.id)
        : null;
      const userRole = memberEntry?.role ?? null;
      const isMember = userRole !== null;

      if (userRole) setMyRole(userRole);

      // Public view: not authenticated or authenticated but not a member
      const publicView = !isAuth || !isMember;
      setIsPublicView(publicView);

      if (publicView) {
        // Public view: only fetch public pricings and collections
        const [publicPricings, publicCollections] = await Promise.all([
          getPublicOrgPricings(organizationId).catch(() => ({ pricings: [], total: 0 })),
          getPublicOrgCollections(organizationId).catch(() => ({ collections: [], total: 0 })),
        ]);
        setPricings(publicPricings.pricings);
        setPricingsTotal(publicPricings.total);
        setCollections(publicCollections.collections);
        setCollectionsTotal(publicCollections.total);
      } else {
        // Member view: full access logic
        const invitationsData =
          userRole === 'OWNER' || userRole === 'ADMIN' ? await listInvitations(organizationId) : [];
        setInvitations(invitationsData);

        if (userRole === 'MEMBER') {
          const [accessiblePricingsResult, , accessibleCollectionsResult, allOrgCollectionsResult] = await Promise.all([
            getUserAccessiblePricings().catch(() => ({ pricings: [], total: 0 })),
            getOrgPricings(organizationId).catch(() => ({ pricings: [], total: 0 })),
            getUserAccessibleCollections().catch(() => ({ collections: [], total: 0 })),
            getOrgCollections(organizationId).catch(() => ({ collections: [], total: 0 })),
          ]);

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
          setPricings(pricingsData.pricings);
          setPricingsTotal(pricingsData.total);

          const collectionsData = await getOrgCollections(organizationId).catch(() => ({
            collections: [],
            total: 0,
          }));
          setCollections(collectionsData.collections);
          setCollectionsTotal(collectionsData.total);
        }

        const children = orgData.subOrganizations ?? [];
        if (userRole === 'OWNER' || userRole === 'ADMIN') {
          const map: Record<string, boolean> = {};
          for (const child of children) map[child.id] = true;
          setChildAccessMap(map);
        } else {
          const results = await Promise.allSettled(
            children.map(async child => {
              await getOrganization(child.id);
              return { id: child.id, ok: true };
            })
          );
          const map: Record<string, boolean> = {};
          children.forEach((child, i) => {
            map[child.id] = results[i].status === 'fulfilled';
          });
          setChildAccessMap(map);
        }
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load organization');
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, authUser.isAuthenticated, authUser.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Hierarchy tree ─── */
  const buildHierarchyTree = useCallback(async () => {
    if (!org) return;

    const buildDescendants = async (
      nodeOrg: Organization,
      accessRole: OrgRole | null
    ): Promise<TreeNode[]> => {
      const children = nodeOrg.subOrganizations ?? [];
      const results: TreeNode[] = [];

      for (const child of children) {
        let hasAccess = false;
        if (accessRole === 'OWNER' || accessRole === 'ADMIN') {
          hasAccess = true;
        } else {
          hasAccess = childAccessMap[child.id] ?? false;
        }

        let childOrgData: Organization | null = null;
        if (hasAccess) {
          try {
            childOrgData = await getOrganization(child.id);
          } catch {
            childOrgData = child;
          }
        }

        const grandchildren =
          hasAccess && childOrgData ? await buildDescendants(childOrgData, accessRole) : [];

        results.push({
          id: child.id,
          displayName: child.displayName,
          name: child.name,
          avatar: child.avatar,
          isPersonal: child.isPersonal,
          _parentId: child._parentId,
          children: grandchildren,
          hasAccess,
        });
      }

      return results;
    };

    const childNodes = await buildDescendants(org, myRole);

    let currentNode: TreeNode = {
      id: org.id,
      displayName: org.displayName,
      name: org.name,
      avatar: org.avatar,
      isPersonal: org.isPersonal,
      _parentId: org._parentId,
      children: childNodes,
      hasAccess: true,
      isCurrent: true,
    };

    if (org._parentId) {
      let currentParentId: string | null = org._parentId;
      while (currentParentId) {
        try {
          const ancestorOrg = await getOrganization(currentParentId);
          const ancestorNode: TreeNode = {
            id: ancestorOrg.id,
            displayName: ancestorOrg.displayName,
            name: ancestorOrg.name,
            avatar: ancestorOrg.avatar,
            isPersonal: ancestorOrg.isPersonal,
            _parentId: ancestorOrg._parentId,
            children: [currentNode],
            hasAccess: true,
            isAncestor: true,
          };
          currentNode = ancestorNode;
          currentParentId = ancestorOrg._parentId;
        } catch {
          break;
        }
      }
    }

    setHierarchyTree(currentNode);
  }, [org, myRole, childAccessMap, getOrganization]);

  useEffect(() => {
    if (org && myRole) buildHierarchyTree();
  }, [org, myRole, childAccessMap]);

  useEffect(() => {
    if (hierarchyTree) {
      setExpandedTreeIds(prev => {
        const next = new Set(prev);
        next.add(hierarchyTree.id);
        return next;
      });
    }
  }, [hierarchyTree?.id]);

  /* ─── Refresh helpers ─── */
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
        const data = isPublicView
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
    [org, isPublicView, getOrgPricings, showOnlyUnlinked]
  );

  const fetchCollections = useCallback(
    async (page: number, search: string) => {
      if (!org) return;

      if (isPublicView) {
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
    [org, isPublicView, myRole, accessibleCollectionNames, allOrgCollections, getOrgCollections]
  );

  /* ─── Effects ─── */
  useEffect(() => {
    if (authUser.isLoading) return;
    if (!organizationId) return;
    loadOrgData();
  }, [authUser.isLoading, organizationId]);

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
      return ['overview', 'members', 'pricings', 'collections'] as Tab[];
    }
    const tabs: Tab[] = [
      'overview',
      'members',
      'invitations',
      'pricings',
      'collections',
      'children',
    ];
    if (canManage) tabs.push('permissions');
    return tabs;
  }, [isPublicView, canManage]);

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
                <OrgAvatar
                  name={org.displayName}
                  avatar={org.avatar}
                  avatarBgColor={org.avatarBgColor}
                  avatarFgColor={org.avatarFgColor}
                  size={80}
                  square
                  className="ring-2 ring-white shadow-elevation-2 sm:h-20 sm:w-20"
                />
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
                  {!isPublicView && myRole && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ROLE_COLORS[myRole]}`}
                    >
                      {ROLE_LABELS[myRole]}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2 sm:ml-0">
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
                    {!isPublicView && !org.isPersonal && (
                      <button
                        type="button"
                        onClick={handleLeaveOrg}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-900/40"
                      >
                        <Iconify icon="mdi:logout" width={15} />
                        Leave
                      </button>
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
        <div className="mx-auto max-w-5xl px-4 md:px-8">
          <div className="py-2 md:hidden">
            <div className="relative">
              <select
                value={activeTab}
                onChange={e => setActiveTab(e.target.value as Tab)}
                className="w-full appearance-none rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 pr-8 text-sm font-medium text-tp-ink transition-colors focus:border-tp-primary focus:outline-none"
              >
                {availableTabs.map(tab => (
                  <option key={tab} value={tab}>
                    {TAB_META[tab].label}
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

          <nav className="hidden gap-1 overflow-x-auto py-1 md:flex" role="tablist">
            {availableTabs.map(tab => {
              const meta = TAB_META[tab];
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
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
              currentUserId={authUser.user?.id}
              onRefresh={refreshMembers}
              onAddMember={() => setAddMemberModalOpen(true)}
              onLeave={() => router.push('/')}
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
              myRole={myRole}
              isPublicView={isPublicView}
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
              myRole={myRole}
              isPublicView={isPublicView}
              onPageChange={setCollectionPage}
              onSearchChange={setCollectionSearch}
            />
          )}

          {!isPublicView && activeTab === 'children' && (
            <HierarchyTab
              org={org}
              canManage={canManage}
              hierarchyTree={hierarchyTree}
              expandedTreeIds={expandedTreeIds}
              onToggle={handleTreeToggle}
              onNavigate={id => router.push(`/orgs/${id}`)}
              onCreateSubOrg={() => setCreateSubOrgModalOpen(true)}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ MODALS ═══ */}
      <AnimatePresence>
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
