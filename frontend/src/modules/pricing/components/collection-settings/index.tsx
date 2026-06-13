import { useEffect, useState } from 'react';
import VisibilityOptions from '../visibility-options';
import customConfirm from '../../../core/utils/custom-confirm';
import customAlert from '../../../core/utils/custom-alert';
import { useRouter } from '../../../core/hooks/useRouter';
import { Collection } from '../../types/collection';
import { usePricingCollectionsApi } from '../../../profile/api/pricingCollectionsApi';
import { motion } from 'framer-motion';
import { transitionDefault } from '../../../core/utils/motion-variants';

export interface CollectionPermissions {
  GET: boolean;
  CREATE: boolean;
  PUT: boolean;
  DELETE: boolean;
}

export default function CollectionSettings({
  organizationId,
  collection,
  permissions,
  onCollectionUpdated,
}: {
  organizationId: string;
  collection: Collection;
  permissions: CollectionPermissions;
  onCollectionUpdated: (collection: Collection) => void;
}) {
  const [visibility, setVisibility] = useState(collection.private ? 'Private' : 'Public');
  const [nameValue, setNameValue] = useState(collection.name);
  const [descriptionValue, setDescriptionValue] = useState(collection.description ?? '');

  const { updateCollection, deleteCollection } = usePricingCollectionsApi();
  const router = useRouter();

  useEffect(() => {
    setVisibility(collection.private ? 'Private' : 'Public');
    setNameValue(collection.name);
    setDescriptionValue(collection.description ?? '');
  }, [collection]);

  function handleRename() {
    const newName = nameValue.trim();
    if (!newName || newName === collection.name) return;

    customConfirm(
      `Are you sure you want to change the name of this collection? You'll be redirected to your profile page.`,
      { danger: false }
    ).then(() => {
      updateCollection(organizationId, collection.slug, { name: newName })
        .then(() => {
          router.push('/collections');
        })
        .catch((error: Error) => {
          customAlert(`Error: ${error.message}`, 'error');
        });
    });
  }

  function handleDescriptionChange() {
    updateCollection(organizationId, collection.slug, { description: descriptionValue })
      .then(() => {
        customAlert('Description updated!', 'success');
      })
      .catch((error: Error) => {
        customAlert(`Error: ${error.message}`, 'error');
      });
  }

  function handleVisibilityChange() {
    customConfirm('Are you sure you want to change the visibility of this collection?', { danger: false })
      .then(() => {
        const collectionUpdateBody = { private: visibility === 'Public' };
        console.log("organizationId:", organizationId);
        updateCollection(organizationId, collection.slug, collectionUpdateBody)
          .then((data: any) => {
            if (data.error) {
              customAlert(`Error: ${data.error}`, 'error');
              return;
            }
            onCollectionUpdated(data);
            setVisibility(visibility === 'Private' ? 'Public' : 'Private');
            customAlert('Visibility updated successfully', 'success');
          })
          .catch((error: Error) => {
            customAlert(`Error: ${error.message}`, 'error');
          });
      })
      .catch(() => {});
  }

  function handleDeleteCollection() {
    customConfirm(
      'Are you sure you want to delete this collection and preserve its pricings? This action is irreversible.',
      { danger: true }
    ).then(() => {
      deleteCollection(organizationId, collection.slug, false)
        .then(() => {
          router.push('/collections');
        })
        .catch(() => {
          customAlert('An error has occurred while removing the collection. Please, try again later.', 'error');
        });
    });
  }

  function handleDeleteCollectionAndPricings() {
    customConfirm(
      'Are you sure you want to delete this collection and its pricings? This action is irreversible.',
      { danger: true }
    ).then(() => {
      deleteCollection(organizationId, collection.slug, true)
        .then(() => {
          router.push('/collections');
        })
        .catch(() => {
          customAlert('An error has occurred while removing the collection. Please, try again later.', 'error');
        });
    });
  }

  const hasAnyPermission = permissions.PUT || permissions.DELETE;

  if (!hasAnyPermission) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline bg-tp-canvas py-16 text-center">
        <p className="text-sm text-tp-steel">You don't have permission to modify this collection.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={transitionDefault}>
      {/* Global Settings - PUT only */}
      {permissions.PUT && (
        <div className="mb-6 rounded-xl border border-tp-hairline bg-tp-canvas p-5">
          <h3 className="mb-4 text-sm font-medium text-tp-ink">General</h3>

          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Name</label>
            <div className="flex items-center gap-3">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="flex-1 rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary"
              />
              <button
                type="button"
                onClick={handleRename}
                disabled={!nameValue.trim() || nameValue === collection.name}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-default disabled:opacity-40"
              >
                Rename
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Description</label>
            <div className="flex items-start gap-3">
              <textarea
                value={descriptionValue}
                onChange={(e) => setDescriptionValue(e.target.value)}
                placeholder="Describe this collection..."
                rows={3}
                className="flex-1 resize-none rounded-lg border border-tp-hairline-strong bg-tp-surface px-3 py-2 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary"
              />
              <button
                type="button"
                onClick={handleDescriptionChange}
                disabled={descriptionValue === (collection.description ?? '')}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-default disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Visibility</label>
            <div className="flex items-center gap-3">
              <VisibilityOptions value={visibility} onChange={() => handleVisibilityChange()} />
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone - DELETE only */}
      {permissions.DELETE && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <h3 className="mb-4 text-sm font-medium text-red-600">Danger zone</h3>

          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-tp-ink">Delete collection</p>
              <p className="mt-0.5 text-xs text-tp-steel">This will delete the collection forever, but preserve its pricings.</p>
            </div>
            <button
              type="button"
              onClick={handleDeleteCollection}
              className="cursor-pointer shrink-0 rounded-lg border border-red-500 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500 hover:text-white"
            >
              Delete collection
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-tp-ink">Delete collection and pricings</p>
              <p className="mt-0.5 text-xs text-tp-steel">This will delete the collection and all pricings associated with it forever.</p>
            </div>
            <button
              type="button"
              onClick={handleDeleteCollectionAndPricings}
              className="cursor-pointer shrink-0 rounded-lg border border-red-500 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500 hover:text-white"
            >
              Delete all
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
