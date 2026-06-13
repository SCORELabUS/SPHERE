import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import { transitionDefault } from '../../../../core/utils/motion-variants';
import { OrgRole, useOrganizationsApi } from '../../../api/organizationsApi';
import type { OrgCollection } from '../../../api/organizationsApi';
import CollectionCard from '../../../../pricing/components/collection-card';
import Pagination from '../../../../pricing/components/pagination';
import { useRouter } from '../../../../core/hooks/useRouter';
import { useAuth } from '../../../../auth/hooks/useAuth';
import { PER_PAGE } from '../types';

interface Props {
  collections: OrgCollection[];
  collectionsTotal: number;
  collectionPage: number;
  collectionSearch: string;
  orgId: string;
  myRole: OrgRole | null;
  isPublicView: boolean;
  onPageChange: (page: number) => void;
  onSearchChange: (value: string) => void;
}

export default function CollectionsTab({ collections, collectionsTotal, collectionPage, collectionSearch, orgId, myRole, isPublicView, onPageChange, onSearchChange }: Props) {
  const { authUser } = useAuth();
  const { getOrgPermissions } = useOrganizationsApi();
  const router = useRouter();
  const [canCreateCollection, setCanCreateCollection] = useState(false);

  useEffect(() => {
    if (isPublicView) {
      setCanCreateCollection(false);
      return;
    }

    if (myRole === 'OWNER' || myRole === 'ADMIN') {
      setCanCreateCollection(true);
      return;
    }

    if (authUser.user?.role === 'ADMIN') {
      setCanCreateCollection(true);
      return;
    }

    if (!orgId || !authUser.user?.id) {
      setCanCreateCollection(false);
      return;
    }

    getOrgPermissions(orgId, 'collection')
      .then(permissions => {
        const orgScoped = permissions.find(
          p => p.entitySlug === null && p._userId === authUser.user?.id
        );
        setCanCreateCollection(orgScoped?.permissions.CREATE ?? false);
      })
      .catch(() => setCanCreateCollection(false));
  }, [orgId, myRole, isPublicView, authUser.user?.id, authUser.user?.role, getOrgPermissions]);

  return (
    <motion.div
      key="collections"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="rounded-xl border border-tp-hairline bg-tp-canvas">
        <div className="flex flex-col gap-3 border-b border-tp-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-tp-ink">Collections</h2>
            <p className="text-xs text-tp-steel">Collections owned by this organization.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="w-full sm:w-64">
              <input
                type="text"
                value={collectionSearch}
                onChange={(e) => { onSearchChange(e.target.value); onPageChange(1); }}
                placeholder="Search collections..."
                className="h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none"
              />
            </div>
            {canCreateCollection && (
              <button
                type="button"
                onClick={() => router.push(`/collections/new?orgId=${orgId}`)}
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
          {collections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-tp-ink">
              <Iconify icon="mdi:folder-off-outline" width={32} />
              <p className="text-sm">No collections found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {collections.map((collection) => (
                <CollectionCard key={collection.id} collection={collection} />
              ))}
            </div>
          )}
        </div>

        {collectionsTotal > PER_PAGE && (
          <div className="border-t border-tp-hairline px-5 py-3">
            <Pagination
              currentPage={collectionPage}
              totalPages={Math.ceil(collectionsTotal / PER_PAGE)}
              onPageChange={onPageChange}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
