import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Iconify from '../../../core/components/iconify';
import OrgAvatar from '../../../core/components/org-avatar';
import { useOrganization } from '../../hooks/useOrganization';
import { Organization, OrgRole } from '../../api/organizationsApi';
import Pagination from '../../../pricing/components/pagination';
import OrgListSkeleton from '../../../core/components/skeletons/org-list-skeleton';
import {
  staggerContainer,
  fadeInUp,
  transitionDefault,
} from '../../../core/utils/motion-variants';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

const ROLE_STYLES: Record<string, string> = {
  OWNER: 'bg-tp-primary/15 text-tp-primary dark:bg-tp-primary/20 dark:text-tp-primary',
  ADMIN:
    'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  MEMBER:
    'bg-tp-surface text-tp-steel dark:bg-white/5 dark:text-tp-muted',
};

function RoleBadge({ role }: { role: OrgRole }) {
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${ROLE_STYLES[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TREE NODE — renders a single org with optional expand/collapse
   ═══════════════════════════════════════════════════════════════ */
function OrgTreeNode({
  org,
  level = 0,
  expandedIds,
  onToggle,
}: {
  org: Organization;
  level?: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const children = org.subOrganizations ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(org.id);

  return (
    <div>
      <motion.div variants={fadeInUp} initial="hidden" animate="visible">
        <Link
          to={`/orgs/${org.id}`}
          className="group flex cursor-pointer items-center gap-4 rounded-lg border border-tp-hairline bg-tp-canvas px-5 py-4 transition-all hover:border-tp-hairline hover:shadow-(--shadow-elevation-2) dark:border-tp-hairline dark:bg-tp-surface dark:hover:border-tp-hairline-strong"
          style={{ marginLeft: level > 0 ? `${level * 24 + 12}px` : undefined }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle(org.id);
              }}
              className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-tp-steel transition-colors hover:bg-tp-hairline"
            >
              <Iconify
                icon={isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                width={14}
              />
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}

          <OrgAvatar
            name={org.displayName || org.name}
            avatar={org.avatar}
            avatarBgColor={org.avatarBgColor}
            avatarFgColor={org.avatarFgColor}
            isPersonal={org.isPersonal}
            size={level > 0 ? 36 : 52}
          />

          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium text-tp-ink dark:text-tp-ink">
              {org.displayName}
            </p>
            <p className="truncate text-sm text-tp-steel dark:text-tp-muted">
              @{org.name}
            </p>
          </div>

          {org.role && <RoleBadge role={org.role} />}

          <Iconify
            icon="mdi:chevron-right"
            width={18}
            className="shrink-0 text-tp-muted transition-transform group-hover:translate-x-0.5 group-hover:text-tp-steel dark:text-tp-stone"
          />
        </Link>
      </motion.div>

      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {children.map((child) => (
              <OrgTreeNode
                key={child.id}
                org={child}
                level={level + 1}
                expandedIds={expandedIds}
                onToggle={onToggle}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function OrganizationsListPage() {
  const { organizations, isLoading, page, totalPages, setPage } = useOrganization();
  const [search, setSearch] = useState('');
  const [expandedTreeIds, setExpandedTreeIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((id: string) => {
    setExpandedTreeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return organizations;
    const q = search.toLowerCase();

    function matchesOrg(org: Organization): boolean {
      if (
        org.displayName.toLowerCase().includes(q) ||
        org.name.toLowerCase().includes(q)
      ) {
        return true;
      }
      return (org.subOrganizations ?? []).some((child) => matchesOrg(child));
    }

    return organizations.filter(matchesOrg);
  }, [organizations, search]);

  const personalOrgs = useMemo(
    () => filtered.filter((o) => o.isPersonal),
    [filtered],
  );
  const otherOrgs = useMemo(
    () => filtered.filter((o) => !o.isPersonal),
    [filtered],
  );

  const totalOrgCount = useMemo(() => {
    function countAll(orgs: Organization[]): number {
      return orgs.reduce((acc, org) => acc + 1 + countAll(org.subOrganizations ?? []), 0);
    }
    return countAll(organizations);
  }, [organizations]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeInUp}
        transition={transitionDefault}
        className="mb-8"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-normal tracking-tight text-tp-ink dark:text-tp-ink">
              Your Organizations
            </h1>
            <p className="mt-1 text-sm text-tp-steel dark:text-tp-muted">
              {totalOrgCount === 0
                ? 'Get started by creating or joining an organization'
                : `${totalOrgCount} organization${totalOrgCount !== 1 ? 's' : ''}`}
            </p>
          </div>
          <Link
            to="/orgs/new"
            className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-tp-primary px-5 py-2.5 text-sm font-medium text-tp-on-primary shadow-sm transition-all hover:bg-tp-primary-deep hover:shadow-md active:scale-[0.98]"
          >
            <Iconify icon="mdi:plus" width={18} />
            New Organization
          </Link>
        </div>
      </motion.div>

      {/* Search */}
      {!isLoading && totalOrgCount > 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeInUp}
          transition={{ ...transitionDefault, delay: 0.05 }}
          className="mb-6"
        >
          <div className="relative">
            <Iconify
              icon="mdi:magnify"
              width={20}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-tp-muted"
            />
            <input
              type="text"
              placeholder="Search organizations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-md border border-tp-hairline-strong bg-tp-canvas py-2.5 pl-10 pr-4 text-sm text-tp-ink placeholder:text-tp-muted focus:border-tp-primary focus:outline-none focus:ring-2 focus:ring-tp-primary/15 dark:border-tp-hairline dark:bg-tp-surface dark:text-tp-ink dark:placeholder:text-tp-stone dark:focus:border-tp-primary dark:focus:ring-tp-primary/20"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-0.5 text-tp-muted transition-colors hover:bg-tp-surface hover:text-tp-steel dark:hover:bg-white/5 dark:hover:text-tp-muted"
              >
                <Iconify icon="mdi:close" width={16} />
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Loading */}
      {isLoading && <OrgListSkeleton />}

      {/* Empty state */}
      {!isLoading && totalOrgCount === 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeInUp}
          transition={{ ...transitionDefault, delay: 0.1 }}
          className="flex flex-col items-center gap-5 rounded-[--radius-xl] border border-dashed border-tp-hairline-strong bg-tp-surface/50 py-20 dark:border-tp-hairline dark:bg-tp-surface"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-tp-cream dark:bg-tp-cream">
            <Iconify
              icon="mdi:domain"
              width={32}
              className="text-tp-primary"
            />
          </div>
          <div className="text-center">
            <p className="text-base font-medium text-tp-ink dark:text-tp-ink">
              No organizations yet
            </p>
            <p className="mt-1 text-sm text-tp-steel dark:text-tp-muted">
              Create a new one or join an existing organization to get started
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/orgs/new"
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-tp-primary px-5 py-2.5 text-sm font-medium text-tp-on-primary transition-all hover:bg-tp-primary-deep active:scale-[0.98]"
            >
              <Iconify icon="mdi:plus" width={18} />
              Create Organization
            </Link>
          </div>
        </motion.div>
      )}

      {/* No search results */}
      {!isLoading &&
        totalOrgCount > 0 &&
        filtered.length === 0 &&
        search.trim() !== '' && (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeInUp}
            className="flex flex-col items-center gap-4 py-16"
          >
            <Iconify
              icon="mdi:magnify-close"
              width={40}
              className="text-tp-muted"
            />
            <p className="text-sm text-tp-steel dark:text-tp-muted">
              No organizations match{' '}
              <span className="font-medium text-tp-ink dark:text-tp-ink">
                &ldquo;{search}&rdquo;
              </span>
            </p>
          </motion.div>
        )}

      {/* Organization sections */}
      {!isLoading && filtered.length > 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="space-y-8"
        >
          {/* Personal org */}
          {personalOrgs.length > 0 && (
            <section>
              <motion.div variants={fadeInUp}>
                <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tp-stone dark:text-tp-muted">
                  <Iconify icon="mdi:account-outline" width={14} />
                  Personal
                </h2>
              </motion.div>
              <div className="space-y-2">
                {personalOrgs.map((org) => (
                  <OrgTreeNode
                    key={org.id}
                    org={org}
                    expandedIds={expandedTreeIds}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Other orgs */}
          {otherOrgs.length > 0 && (
            <section>
              <motion.div variants={fadeInUp}>
                <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tp-stone dark:text-tp-muted">
                  <Iconify icon="mdi:account-group-outline" width={14} />
                  Teams
                </h2>
              </motion.div>
              <div className="space-y-2">
                {otherOrgs.map((org) => (
                  <OrgTreeNode
                    key={org.id}
                    org={org}
                    expandedIds={expandedTreeIds}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </section>
          )}
        </motion.div>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="mt-8">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
