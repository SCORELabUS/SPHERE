import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import VisibilityOptions from '../visibility-options';
import FileUpload from '../../../core/components/file-upload-input';
import OrganizationSelector from '../organization-selector';
import SlugPreview from '../../../core/components/slug-preview';
import BlockAlert from '../../../core/components/block-alert';
import { usePricingsApi } from '../../api/pricingsApi';
import { useRouter } from '../../../core/hooks/useRouter';
import { retrievePricingFromYaml } from 'pricing4ts';
import customAlert from '../../../core/utils/custom-alert';
import { Organization, useOrganizationsApi } from '../../../organization/api/organizationsApi';
import { useAuth } from '../../../auth/hooks/useAuth';

export default function CreatePricingForm() {
  const [pricingName, setPricingName] = useState('');
  const [useYamlName, setUseYamlName] = useState(false);
  const [visibility, setVisibility] = useState('Public');
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [canCreate, setCanCreate] = useState(true);
  const [dismissedPermissionError, setDismissedPermissionError] = useState(false);

  const { createPricing } = usePricingsApi();
  const { getOrgPermissions } = useOrganizationsApi();
  const { authUser } = useAuth();
  const router = useRouter();
  const prevOrgIdRef = useRef<string | null>(null);
  const [searchParams] = useSearchParams();
  const initialOrgId = searchParams.get('orgId') ?? undefined;

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

    getOrgPermissions(selectedOrg.id, 'pricing')
      .then(permissions => {
        const orgScoped = permissions.find(
          p => p.entitySlug === null && p._userId === authUser.user?.id
        );
        setCanCreate(orgScoped?.permissions.CREATE ?? false);
      })
      .catch(() => setCanCreate(false));
  }, [selectedOrg, authUser.user?.id, authUser.user?.role, getOrgPermissions]);

  const handleSubmit = (file: File) => {
    if (!selectedOrg) {
      customAlert('Please select an organization', 'warning');
      return;
    }
    if (!useYamlName && !pricingName.trim()) {
      customAlert('Please enter a pricing name', 'warning');
      return;
    }

    file.text().then(text => {
      try {
        const uploadedPricing = retrievePricingFromYaml(text);
        setErrors([]);
        const formData = new FormData();
        if (!useYamlName && pricingName.trim()) {
          formData.append('name', pricingName.trim());
        }
        formData.append('saasName', uploadedPricing.saasName);
        formData.append('version', uploadedPricing.version);
        formData.append('yaml', file);
        formData.append('private', visibility === 'Private' ? 'true' : 'false');
        createPricing(formData, selectedOrg.id, setErrors).then(() => {
          router.push('/');
        }).catch((error) => {
          console.error('Error creating pricing:', error);
        });
      } catch (e) {
        setErrors([(e as Error).message]);
      }
    });
  };

  return (
    <form className="flex flex-col gap-3">
      {initialOrgId && (
        <button
          type="button"
          onClick={() => router.push(`/orgs/${initialOrgId}`)}
          className="mb-2 inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm text-tp-steel transition-colors hover:text-tp-ink"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to organization
        </button>
      )}
      <h2 className="mb-5 text-center text-2xl font-bold">
        Upload a pricing to SPHERE
      </h2>

      <div className="flex items-start gap-3">
        <div className="flex-1">
          <OrganizationSelector value={selectedOrg} onChange={setSelectedOrg} initialOrgId={initialOrgId} />
        </div>

        <div className="pt-7 text-2xl text-slate-400">
          /
        </div>

        <div className="flex-2">
          <label className="mb-1 block text-sm text-slate-700">
            Pricing Name
          </label>
          <input
            placeholder={useYamlName ? 'Will use YAML name' : 'e.g. GitHub'}
            value={useYamlName ? '' : pricingName}
            onChange={e => setPricingName(e.target.value)}
            disabled={useYamlName}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors hover:border-slate-400 focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div
            className={`transition-all duration-300 ease-in-out overflow-hidden ${!useYamlName && pricingName.trim() ? 'max-h-8 opacity-100' : 'max-h-0 opacity-0'}`}
          >
            <SlugPreview value={pricingName} />
          </div>
          <label className="mt-1 flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <span
              onClick={() => setUseYamlName(!useYamlName)}
              className={`relative inline-block h-4 w-7 rounded-full transition-colors ${useYamlName ? 'bg-tp-primary' : 'bg-slate-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${useYamlName ? 'translate-x-3' : 'translate-x-0'}`}
              />
            </span>
            Use name from YAML
          </label>
        </div>
      </div>

      {selectedOrg && !canCreate && !dismissedPermissionError && (
        <BlockAlert variant="error" onDismiss={() => setDismissedPermissionError(true)}>
          You don't have permission to create a pricing in this organization. Please contact an administrator to grant the necessary permissions.
        </BlockAlert>
      )}

      <VisibilityOptions value={visibility} onChange={setVisibility} />

      <FileUpload
        onSubmit={handleSubmit}
        submitButtonText="Upload Pricing"
        submitButtonWidth={400}
        isDragActiveText="Drop a Pricing2Yaml file here"
        isNotDragActiveText="Drag and drop a Pricing2Yaml file here"
        disabled={!canCreate}
      />

      {errors.length > 0 && (
        <div className="mt-2 rounded-md bg-red-50 p-3">
          {errors.map((err, i) => (
            <p key={i} className="text-sm text-red-600">{err}</p>
          ))}
        </div>
      )}

      <div className="h-12" />
    </form>
  );
}
