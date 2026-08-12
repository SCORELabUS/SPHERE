import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiArrowUpRight, FiCheck, FiGlobe, FiLock, FiUploadCloud, FiX } from 'react-icons/fi';
import { retrievePricingFromYaml } from 'pricing4ts';
import { usePricingsApi } from '../../../pricing/api/pricingsApi';
import { Organization, useOrganizationsApi } from '../../../organization/api/organizationsApi';
import { useRouter } from '../../../core/hooks/useRouter';
import OrgAvatar from '../../../core/components/org-avatar';

interface PublishPricingModalProps {
  yaml: string;
  onClose: () => void;
}

function flattenOrganizations(organizations: Organization[]): Organization[] {
  return organizations.flatMap(organization => [
    organization,
    ...flattenOrganizations(organization.subOrganizations ?? []),
  ]);
}

function formatPublishError(message: string): string {
  return message.replace(/^(CONFLICT|INVALID DATA):\s*/i, '');
}

export default function PublishPricingModal({ yaml, onClose }: PublishPricingModalProps) {
  const router = useRouter();
  const { createPricing } = usePricingsApi();
  const { getMyOrganizations } = useOrganizationsApi();
  const parsedPricing = useMemo(() => {
    try {
      return { pricing: retrievePricingFromYaml(yaml), error: '' };
    } catch (error) {
      return { pricing: null, error: (error as Error).message || 'The current YAML is not valid.' };
    }
  }, [yaml]);

  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(true);
  const [pricingName, setPricingName] = useState(parsedPricing.pricing?.saasName || '');
  const [visibility, setVisibility] = useState<'Public' | 'Private'>('Public');
  const [errors, setErrors] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    let active = true;
    getMyOrganizations()
      .then(result => {
        if (!active) return;
        const availableOrganizations = Array.isArray(result) ? result : result.items;
        setOrganizations(flattenOrganizations(availableOrganizations));
      })
      .catch(() => {
        if (active) setOrganizations([]);
      })
      .finally(() => {
        if (active) setOrganizationsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [getMyOrganizations]);

  const handlePublish = async () => {
    if (!parsedPricing.pricing || !selectedOrg || !pricingName.trim()) return;

    setErrors([]);
    setIsPublishing(true);
    const filename = `${parsedPricing.pricing.saasName || 'pricing'}.yaml`;
    const file = new File([yaml], filename, { type: 'application/x-yaml' });
    const formData = new FormData();
    formData.append('name', pricingName.trim());
    formData.append('saasName', parsedPricing.pricing.saasName);
    formData.append('version', parsedPricing.pricing.version);
    formData.append('yaml', file);
    formData.append('private', visibility === 'Private' ? 'true' : 'false');

    try {
      const createdPricing = await createPricing(
        formData,
        selectedOrg.id,
        publishErrors => setErrors(publishErrors.map(formatPublishError))
      );
      if (!createdPricing) return;
      onClose();
      router.push(`/pricings/${selectedOrg.id}/${createdPricing.slug}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The pricing could not be published.';
      setErrors(current => current.length > 0 ? current : [formatPublishError(message)]);
    } finally {
      setIsPublishing(false);
    }
  };

  const canPublish = Boolean(parsedPricing.pricing && selectedOrg && pricingName.trim() && !isPublishing);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-pricing-title"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[36rem] flex-col overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-4 sm:max-h-[calc(100dvh-2rem)]"
        onClick={event => event.stopPropagation()}
      >
        <div className="relative shrink-0 overflow-hidden border-b border-tp-hairline bg-tp-surface px-5 py-4 sm:px-6 sm:py-5">
          <div className="absolute -right-8 -top-12 h-32 w-32 rounded-full bg-tp-primary/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tp-primary text-tp-on-primary shadow-sm">
                <FiUploadCloud className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tp-primary">Current editor draft</p>
                <h2 id="publish-pricing-title" className="mt-1 font-display text-xl font-semibold text-tp-ink">Publish to SPHERE</h2>
                <p className="mt-1 text-sm leading-5 text-tp-steel">Create a pricing directly from the YAML open in your editor.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close publish dialog" className="cursor-pointer rounded-lg p-2 text-tp-steel transition-colors hover:bg-tp-canvas hover:text-tp-ink">
              <FiX className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {parsedPricing.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">The YAML needs attention before publishing.</p>
              <p className="mt-1 text-xs leading-5 text-red-600">{parsedPricing.error}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white"><FiCheck className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-medium text-emerald-900">YAML ready to publish</p>
                <p className="text-xs text-emerald-700">{parsedPricing.pricing?.saasName} · version {parsedPricing.pricing?.version}</p>
              </div>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-sm text-tp-slate">Organization</span>
            <span className="relative block">
              {selectedOrg ? (
                <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">
                  <OrgAvatar
                    name={selectedOrg.displayName || selectedOrg.name}
                    avatar={selectedOrg.avatar}
                    avatarBgColor={selectedOrg.avatarBgColor}
                    avatarFgColor={selectedOrg.avatarFgColor}
                    size={22}
                  />
                </span>
              ) : null}
              <select
                value={selectedOrg?.id ?? ''}
                onChange={event => setSelectedOrg(organizations.find(organization => organization.id === event.target.value) ?? null)}
                disabled={organizationsLoading}
                className={`h-11 w-full cursor-pointer appearance-none rounded-md border border-tp-hairline-strong bg-tp-canvas pr-10 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10 disabled:cursor-wait disabled:opacity-60 ${selectedOrg ? 'pl-11' : 'pl-3'}`}
              >
                <option value="">{organizationsLoading ? 'Loading organizations…' : 'Select an organization'}</option>
                {organizations.map(organization => (
                  <option key={organization.id} value={organization.id}>
                    {organization.displayName} · {organization.role ?? 'MEMBER'}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tp-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </span>
            {!organizationsLoading && organizations.length === 0 ? (
              <span className="mt-1.5 block text-xs text-amber-700">You need an organization before you can publish a pricing.</span>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-tp-slate">Pricing name</span>
            <input
              value={pricingName}
              onChange={event => setPricingName(event.target.value)}
              placeholder="e.g. Clockify"
              className="h-10 w-full rounded-md border border-tp-hairline-strong bg-tp-canvas px-3 text-sm text-tp-ink outline-none transition-colors placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
            />
          </label>

          <fieldset>
            <legend className="mb-2 text-sm text-tp-slate">Visibility</legend>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-tp-surface p-1.5">
              {([
                { value: 'Public' as const, label: 'Public', description: 'Visible in Explore', icon: FiGlobe },
                { value: 'Private' as const, label: 'Private', description: 'Organization only', icon: FiLock },
              ]).map(option => {
                const Icon = option.icon;
                const selected = visibility === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVisibility(option.value)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${selected ? 'border-tp-primary/30 bg-tp-canvas text-tp-ink shadow-sm' : 'border-transparent text-tp-steel hover:text-tp-ink'}`}
                  >
                    <Icon className={`h-4 w-4 ${selected ? 'text-tp-primary' : ''}`} />
                    <span>
                      <span className="block text-xs font-medium">{option.label}</span>
                      <span className="block text-[10px] text-tp-muted">{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <AnimatePresence>
            {errors.length > 0 ? (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3" role="alert">
                {errors.map(error => <p key={error} className="text-xs leading-5 text-red-700">{error}</p>)}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-tp-hairline bg-tp-surface px-5 py-3 sm:px-6 sm:py-4">
          <p className="hidden text-xs text-tp-muted sm:block">A new pricing will be created in the selected organization.</p>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-tp-slate transition-colors hover:bg-tp-canvas hover:text-tp-ink">Cancel</button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={!canPublish}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-tp-primary px-4 py-2 text-sm font-semibold text-tp-on-primary transition-all hover:bg-tp-primary-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isPublishing ? 'Publishing…' : 'Publish'}
              {!isPublishing ? <FiArrowUpRight className="h-4 w-4" /> : null}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
