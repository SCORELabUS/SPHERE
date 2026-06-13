import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { transitionDefault } from '../../../../core/utils/motion-variants';
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
      <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas">
        <div className="flex flex-col gap-3 border-b border-tp-hairline-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-tp-ink">Pricings</h2>
            <p className="text-xs text-tp-steel">Pricings owned by this organization.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex flex-col gap-2 sm:w-64">
              <input
                type="text"
                value={pricingSearch}
                onChange={(e) => { onSearchChange(e.target.value); onPageChange(1); }}
                placeholder="Search pricings..."
                className="h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none"
              />
              <label className="relative flex cursor-pointer items-center gap-2 text-xs text-tp-steel">
                <input
                  type="checkbox"
                  checked={showOnlyUnlinked}
                  onChange={(e) => { onToggleUnlinked(e.target.checked); onPageChange(1); }}
                  className="h-3.5 w-3.5 rounded border-tp-input-border text-tp-primary focus:ring-tp-primary"
                />
                Only unlinked pricings
              </label>
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
          <div className="border-t border-tp-hairline-soft px-5 py-3">
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
