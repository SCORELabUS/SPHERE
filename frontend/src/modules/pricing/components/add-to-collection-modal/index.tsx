import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { usePricingCollectionsApi } from '../../../profile/api/pricingCollectionsApi';
import { usePricingsApi } from '../../api/pricingsApi';
import customAlert from '../../../core/utils/custom-alert';
import { useParams } from 'react-router-dom';

interface Collection {
  id: string;
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string };
}

interface Props {
  pricingName: string;
  pricingSlug: string;
  onAdded: () => void;
  onClose: () => void;
}

export default function AddToCollectionModal({ pricingName, pricingSlug, onAdded, onClose }: Props) {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { getPermissionBasedUserCollections } = usePricingCollectionsApi();
  const { addPricingToCollection } = usePricingsApi();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    getPermissionBasedUserCollections({ organizationIds: organizationId! })
      .then(data => setCollections(data.collections ?? []))
      .catch(() => setCollections([]))
      .finally(() => setIsLoading(false));
  }, [getPermissionBasedUserCollections, organizationId]);

  const filtered = collections.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async (collection: Collection) => {
    if (isAdding) return;
    setIsAdding(true);
    try {
      await addPricingToCollection(organizationId!, pricingSlug, collection.id);
      customAlert(`"${pricingName}" added to "${collection.name}"`, 'success');
      onAdded();
    } catch {
      customAlert('Failed to add pricing to collection', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-112 rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg font-semibold text-tp-ink">Add to collection</h2>
        <p className="mb-4 text-sm text-tp-steel">
          Select a collection to add <span className="font-medium text-tp-ink">{pricingName}</span>
        </p>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search collections..."
          className="mb-3 h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none"
        />

        <div className="max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-tp-steel">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-tp-steel">No collections found</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(collection => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => handleAdd(collection)}
                  disabled={isAdding}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-tp-surface disabled:opacity-50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-tp-surface text-xs font-medium text-tp-ink">
                    {collection.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-tp-ink">{collection.name}</p>
                    <p className="truncate text-[11px] text-tp-steel">
                      {collection.organization.displayName || collection.organization.name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-4 py-1.5 text-xs font-medium text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
