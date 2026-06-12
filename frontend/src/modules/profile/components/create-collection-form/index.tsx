import { useState, useEffect, useRef } from 'react';
import VisibilityOptions from '../../../pricing/components/visibility-options';
import CollectionDescriptionInput from '../collection-description-input';
import PricingSelector from '../pricings-selector';
import OrganizationSelector from '../../../pricing/components/organization-selector';
import SlugPreview from '../../../core/components/slug-preview';
import BlockAlert from '../../../core/components/block-alert';
import { usePricingCollectionsApi } from '../../api/pricingCollectionsApi';
import { useRouter } from '../../../core/hooks/useRouter';
import FileUpload from '../../../core/components/file-upload-input';
import customAlert from '../../../core/utils/custom-alert';
import customConfirm from '../../../core/utils/custom-confirm';
import { Organization, useOrganizationsApi } from '../../../organization/api/organizationsApi';
import { useAuth } from '../../../auth/hooks/useAuth';
import ActionButton from '../../../core/components/action-button';

export type CreateCollectionFormFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

export type CreateCollectionFormProps = {
  readonly setShowLoading: (show: boolean) => void;
};

export default function CreateCollectionForm({ setShowLoading }: CreateCollectionFormProps) {
  const [collectionName, setCollectionName] = useState('');
  const [collectionDescription, setCollectionDescription] = useState('');
  const [visibility, setVisibility] = useState('Public');
  const [selectedPricings, setSelectedPricings] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [canCreate, setCanCreate] = useState(true);
  const [dismissedPermissionError, setDismissedPermissionError] = useState(false);

  const { createCollection, createBulkCollection, deleteCollection } = usePricingCollectionsApi();
  const { getOrgPermissions } = useOrganizationsApi();
  const { authUser } = useAuth();
  const router = useRouter();
  const prevOrgIdRef = useRef<string | null>(null);

  useEffect(() => {
    const orgId = selectedOrg?.id ?? null;
    if (orgId !== prevOrgIdRef.current) {
      prevOrgIdRef.current = orgId;
      setDismissedPermissionError(false);
    }

    if (!selectedOrg) {
      setCanCreate(true);
      return;
    }

    if (authUser.user?.role === 'ADMIN' || selectedOrg.role === 'OWNER' || selectedOrg.role === 'ADMIN') {
      setCanCreate(true);
      return;
    }

    getOrgPermissions(selectedOrg.id, 'collection')
      .then(permissions => {
        const orgScoped = permissions.find(
          p => p.entitySlug === null && p._userId === authUser.user?.id
        );
        setCanCreate(orgScoped?.permissions.CREATE ?? false);
      })
      .catch(() => setCanCreate(false));
  }, [selectedOrg, authUser.user?.id, authUser.user?.role, getOrgPermissions]);

  const handleSubmit = (file?: File | null) => {
    if (!selectedOrg) {
      customAlert('Please select an organization', 'warning');
      return;
    }

    const fileToUpload = file instanceof File ? file : null;

    if (!fileToUpload) {
      const collectionToCreate = {
        name: collectionName,
        description: collectionDescription,
        private: visibility === 'Private',
        pricings: selectedPricings,
      };

      createCollection(collectionToCreate, selectedOrg.id)
        .then(() => {
          router.push('/me/collections');
        })
        .catch(error => {
          // If API returned an Error with status 409, show duplicate alert and keep form
          if (error instanceof Error) {
            customAlert(error.message, 'error');
            return;
          }
          customAlert(error instanceof Error ? error.message : String(error), 'error');
        });
    } else {
      const formData = new FormData();

      formData.append('zip', fileToUpload);
      formData.append('name', collectionName);
      formData.append('description', collectionDescription);
      formData.append('private', visibility === 'Private' ? 'true' : 'false');

      setShowLoading(true);

      createBulkCollection(formData, selectedOrg.id)
        .then(data => {
          setShowLoading(false);
          handleBulkSuccess(data);
        })
        .catch(error => {
          setShowLoading(false);
          if (error instanceof Error && (error as unknown as { status?: number }).status === 409) {
            customAlert(error.message, 'error');
            return;
          }
          customAlert(error instanceof Error ? error.message : String(error), 'error');
        });
    }
  };

  function handleBulkSuccess(data: {
    pricingsWithErrors?: Array<{ name: string; error: string }>;
  }) {
    if (data.pricingsWithErrors && data.pricingsWithErrors.length > 0) {
      customConfirm(
        `Some pricings could not be added to the collection due to errors: ${data.pricingsWithErrors.map((p: { name: string; error: string }) => p.name).join(' | ')}. Do you still want to save the collection and add them again manually?`,
        { danger: false }
      )
        .then(() => {
          router.push('/me/collections');
        })
        .catch(() => {
          if (selectedOrg) {
            deleteCollection(selectedOrg.id, collectionName, true).then(() => {
              router.push('/me/collections');
            });
          }
        });
    } else {
      router.push('/me/collections');
    }
  }

  function handleAddCollectionClick() {
    handleSubmit();
  }

  return (
    <form className="flex flex-col gap-3">
      <h2 className="mb-5 text-center text-2xl font-bold">
        Create a collection to store your pricings
      </h2>

      <div className="flex items-end gap-1">
        <div className="flex-1">
          <OrganizationSelector value={selectedOrg} onChange={setSelectedOrg} />
        </div>

        <div className="text-4xl text-slate-400">/</div>

        <div className="relative flex-2">
          <label className="absolute -top-8 left-0 block text-base text-slate-700">
            Collection Name
          </label>
          <input
            placeholder="e.g. My Collection"
            value={collectionName}
            onChange={e => setCollectionName(e.target.value)}
            className="w-full rounded-md border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20"
          />
        </div>
      </div>

      <SlugPreview value={collectionName} />
      {selectedOrg && !canCreate && !dismissedPermissionError && (
        <BlockAlert variant="error" onDismiss={() => setDismissedPermissionError(true)}>
          You don't have permission to create a collection in this organization. Please contact an administrator to grant the necessary permissions.
        </BlockAlert>
      )}
      <CollectionDescriptionInput
        value={collectionDescription}
        onChange={setCollectionDescription}
      />
      <VisibilityOptions value={visibility} onChange={setVisibility} />
      <div className="border-b border-slate-300">
        <div className="flex gap-2">
          <button
            type="button"
            className={`cursor-pointer rounded-t-md px-4 py-2 ${tabValue === 0 ? 'bg-tp-primary text-white' : 'bg-slate-100 text-slate-700'}`}
            onClick={() => setTabValue(0)}
          >
            Select unassigned pricings
          </button>
          <button
            type="button"
            className={`cursor-pointer rounded-t-md px-4 py-2 ${tabValue === 1 ? 'bg-tp-primary text-white' : 'bg-slate-100 text-slate-700'}`}
            onClick={() => setTabValue(1)}
          >
            Upload collection
          </button>
        </div>
      </div>
      {tabValue === 0 ? (
        <>
          <PricingSelector value={selectedPricings} onChange={setSelectedPricings} />{' '}
          <div className="flex items-center justify-center">
            <ActionButton 
              text='Add Collection' 
              onClick={handleAddCollectionClick} 
              disabled={!canCreate} 
              className={`mt-5 mb-12 rounded-md px-5 py-2 text-base font-bold cursor-pointer disabled:cursor-not-allowed disabled:bg-tp-primary/50 ${canCreate ? 'bg-tp-primary text-white' : 'bg-slate-200 text-slate-500'}`}/>
          </div>
        </>
      ) : (
        <>
          <FileUpload
            onSubmit={handleSubmit}
            submitButtonText="Add Collection"
            submitButtonWidth={400}
            isDragActiveText="Drop a .zip file containing all the pricings of the collection"
            isNotDragActiveText="Drag and drop a .zip file containing all the pricings of the collection"
            accept={{ 'application/zip': ['.zip'] }}
            disabled={!canCreate}
          />
          <div className="mb-12" />
        </>
      )}
    </form>
  );
}
