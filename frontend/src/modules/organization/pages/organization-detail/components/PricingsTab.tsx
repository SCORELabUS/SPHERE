import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { dropdownVariants, transitionDefault, transitionFast } from '../../../../core/utils/motion-variants';
import { OrgPricing, OrgRole, useOrganizationsApi } from '../../../api/organizationsApi';
import type { EntityPermission } from '../../../types/permissions';
import { useAuth } from '../../../../auth/hooks/useAuth';
import { useRouter } from '../../../../core/hooks/useRouter';
import PricingCard, { type MenuItem } from '../../../../pricing/components/pricing-card';
import AddToCollectionModal from '../../../../pricing/components/add-to-collection-modal';
import Pagination from '../../../../pricing/components/pagination';
import { PER_PAGE } from '../types';

interface Props {
  pricings: OrgPricing[];
  pricingsTotal: number;
  pricingPage: number;
  pricingSearch: string;
  showOnlyUnlinked: boolean;
  orgId: string;
  myRole: OrgRole | null;
  isPublicView: boolean;
  onPageChange: (page: number) => void;
  onSearchChange: (value: string) => void;
  onToggleUnlinked: (value: boolean) => void;
  onPricingAdded?: () => void;
}

export default function PricingsTab({ pricings, pricingsTotal, pricingPage, pricingSearch, showOnlyUnlinked, orgId, myRole, isPublicView, onPageChange, onSearchChange, onToggleUnlinked, onPricingAdded }: Props) {
  const { authUser } = useAuth();
  const { getOrgPermissions } = useOrganizationsApi();
  const router = useRouter();
  const [pricingPermissions, setPricingPermissions] = useState<EntityPermission[]>([]);
  const [addToCollectionPricing, setAddToCollectionPricing] = useState<OrgPricing | null>(null);
  const [canCreatePricing, setCanCreatePricing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authUser.isAuthenticated || !orgId) return;
    getOrgPermissions(orgId, 'pricing')
      .then(perms => setPricingPermissions(perms))
      .catch(() => setPricingPermissions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, authUser.isAuthenticated]);

  useEffect(() => {
    if (isPublicView) {
      setCanCreatePricing(false);
      return;
    }

    if (myRole === 'OWNER' || myRole === 'ADMIN') {
      setCanCreatePricing(true);
      return;
    }

    if (authUser.user?.role === 'ADMIN') {
      setCanCreatePricing(true);
      return;
    }

    if (!orgId || !authUser.user?.id) {
      setCanCreatePricing(false);
      return;
    }

    getOrgPermissions(orgId, 'pricing')
      .then(permissions => {
        const orgScoped = permissions.find(
          p => p.entitySlug === null && p._userId === authUser.user?.id
        );
        setCanCreatePricing(orgScoped?.permissions.CREATE ?? false);
      })
      .catch(() => setCanCreatePricing(false));
  }, [orgId, myRole, isPublicView, authUser.user?.id, authUser.user?.role, getOrgPermissions]);

  useEffect(() => {
    if (!showFilters) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilters]);

  const hasPutPermission = (pricingSlug: string) => {
    if (myRole === 'OWNER' || myRole === 'ADMIN') return true;
    return pricingPermissions.some(
      p => p.entitySlug === pricingSlug && p.permissions.PUT
    );
  };

  return (
    <motion.div
      key="pricings"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="rounded-xl border border-tp-hairline bg-tp-canvas">
        <div className="flex pb-8 flex-col gap-3 border-b border-tp-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-tp-ink">Pricings</h2>
            <p className="text-xs text-tp-steel">Pricings owned by this organization.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <input
              type="text"
              value={pricingSearch}
              onChange={(e) => { onSearchChange(e.target.value); onPageChange(1); }}
              placeholder="Search pricings..."
              className="h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none sm:w-64"
            />
            <div className="relative" ref={filtersRef}>
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                  showOnlyUnlinked
                    ? 'border-tp-primary/30 bg-tp-primary/5 text-tp-primary'
                    : 'border-tp-hairline-strong bg-tp-canvas text-tp-slate hover:border-tp-hairline'
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filters
                {showOnlyUnlinked && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tp-primary text-[9px] text-tp-on-primary">1</span>
                )}
                <svg className={`h-3 w-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    variants={dropdownVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={transitionFast}
                    className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4"
                  >
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-tp-surface">
                      <input
                        type="checkbox"
                        checked={showOnlyUnlinked}
                        onChange={(e) => { onToggleUnlinked(e.target.checked); onPageChange(1); }}
                        className="h-3.5 w-3.5 rounded border-tp-hairline-strong text-tp-primary focus:ring-tp-primary"
                      />
                      <span className="flex-1 text-tp-slate">Only unlinked pricings</span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {canCreatePricing && (
              <button
                type="button"
                onClick={() => router.push(`/pricings/new?orgId=${orgId}`)}
                className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-tp-primary/90"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add
              </button>
            )}
          </div>
        </div>

        <div className="min-h-105 p-4">
          {pricings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-tp-ink">
              <FaFileInvoiceDollar size={32} className="text-tp-muted" />
              <p className="text-sm">No pricings found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pricings.map((pricing) => {
                const isUnlinked = !pricing.collection?.id;
                const showMenu = isUnlinked && hasPutPermission(pricing.slug);
                const menuItems: MenuItem[] = showMenu
                  ? [{
                      label: 'Add to collection',
                      icon: 'plus',
                      onClick: () => setAddToCollectionPricing(pricing),
                    }]
                  : [];

                return (
                  <PricingCard
                    key={`${pricing.name}-${pricing.version}`}
                    data={pricing}
                    showMenu={showMenu}
                    menuItems={menuItems}
                  />
                );
              })}
            </div>
          )}
        </div>

        {pricingsTotal > PER_PAGE && (
          <div className="border-t border-tp-hairline px-5 py-3">
            <Pagination
              currentPage={pricingPage}
              totalPages={Math.ceil(pricingsTotal / PER_PAGE)}
              onPageChange={onPageChange}
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {addToCollectionPricing && (
          <AddToCollectionModal
            pricingName={addToCollectionPricing.name}
            pricingSlug={addToCollectionPricing.slug}
            onAdded={() => {
              setAddToCollectionPricing(null);
              onPricingAdded?.();
            }}
            onClose={() => setAddToCollectionPricing(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
