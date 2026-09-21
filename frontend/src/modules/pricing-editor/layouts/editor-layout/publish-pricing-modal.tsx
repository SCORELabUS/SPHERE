import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FiArrowUpRight,
  FiCheck,
  FiFilePlus,
  FiGlobe,
  FiLock,
  FiSearch,
  FiUploadCloud,
  FiX,
} from 'react-icons/fi';
import { retrievePricingFromYaml } from 'pricing4ts';
import { usePricingsApi } from '../../../pricing/api/pricingsApi';
import Pagination from '../../../pricing/components/pagination';
import { Organization, useOrganizationsApi } from '../../../organization/api/organizationsApi';
import { useRouter } from '../../../core/hooks/useRouter';
import OrgAvatar from '../../../core/components/org-avatar';
import customConfirm from '../../../core/utils/custom-confirm';

interface PublishPricingModalProps {
  yaml: string;
  onClose: () => void;
}
interface AccessiblePricing {
  id: string;
  name: string;
  slug: string;
  version: string;
  createdAt: string;
  private: boolean;
  organization: { id: string; name: string; displayName: string; avatar: string | null };
  collection: { id: string; name: string; slug: string } | null;
}

const PRICINGS_PER_PAGE = 6;
const flattenOrganizations = (organizations: Organization[]): Organization[] =>
  organizations.flatMap(org => [org, ...flattenOrganizations(org.subOrganizations ?? [])]);
const formatPublishError = (message: string) =>
  message.replace(/^(CONFLICT|INVALID DATA):\s*/i, '');
const formatDate = (date: string | Date) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? String(date)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value);
};
const sameName = (pricing: AccessiblePricing, name?: string) =>
  pricing.name.trim().toLowerCase() === name?.trim().toLowerCase();

export default function PublishPricingModal({ yaml, onClose }: PublishPricingModalProps) {
  const router = useRouter();
  const { createPricing, createPricingVersion, getPermissionBasedUserPricings } = usePricingsApi();
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
  const [destination, setDestination] = useState<'new' | 'version'>('new');
  const [selectedPricing, setSelectedPricing] = useState<AccessiblePricing | null>(null);
  const [matchingPricings, setMatchingPricings] = useState<AccessiblePricing[]>([]);
  const [pricings, setPricings] = useState<AccessiblePricing[]>([]);
  const [pricingsTotal, setPricingsTotal] = useState(0);
  const [pricingSearch, setPricingSearch] = useState('');
  const deferredSearch = useDeferredValue(pricingSearch);
  const [pricingPage, setPricingPage] = useState(1);
  const [pricingsLoading, setPricingsLoading] = useState(true);
  const [pricingsError, setPricingsError] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const didSetDefaultPricing = useRef(false);

  useEffect(() => {
    let active = true;
    getMyOrganizations()
      .then(result => {
        if (active)
          setOrganizations(flattenOrganizations(Array.isArray(result) ? result : result.items));
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

  useEffect(() => {
    let active = true;
    setPricingsLoading(true);
    setPricingsError('');
    getPermissionBasedUserPricings({
      limit: PRICINGS_PER_PAGE,
      offset: (pricingPage - 1) * PRICINGS_PER_PAGE,
      name: deferredSearch,
    })
      .then(result => {
        if (active) {
          setPricings(result.pricings ?? []);
          setPricingsTotal(result.total ?? 0);
        }
      })
      .catch(() => {
        if (active) {
          setPricings([]);
          setPricingsTotal(0);
          setPricingsError('Your pricings could not be loaded. Try again in a moment.');
        }
      })
      .finally(() => {
        if (active) setPricingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deferredSearch, getPermissionBasedUserPricings, pricingPage]);

  useEffect(() => {
    const saasName = parsedPricing.pricing?.saasName;
    if (!saasName) return;
    let active = true;
    getPermissionBasedUserPricings({ name: saasName, limit: PRICINGS_PER_PAGE, offset: 0 })
      .then(result => {
        if (!active) return;
        const exactMatches = (result.pricings ?? []).filter((pricing: AccessiblePricing) =>
          sameName(pricing, saasName)
        );
        setMatchingPricings(exactMatches);
        if (!didSetDefaultPricing.current && exactMatches.length === 1) {
          didSetDefaultPricing.current = true;
          setSelectedPricing(exactMatches[0]);
          setDestination('version');
        }
      })
      .catch(() => {
        if (active) setMatchingPricings([]);
      });
    return () => {
      active = false;
    };
  }, [getPermissionBasedUserPricings, parsedPricing.pricing?.saasName]);

  const selectPricing = (pricing: AccessiblePricing) => {
    setSelectedPricing(pricing);
    setDestination('version');
    setErrors([]);
  };
  const handlePublish = async () => {
    if (
      !parsedPricing.pricing ||
      (destination === 'new' && (!selectedOrg || !pricingName.trim())) ||
      (destination === 'version' && !selectedPricing)
    )
      return;
    if (destination === 'version' && selectedPricing) {
      const draftDate = new Date(parsedPricing.pricing.createdAt ?? '').getTime();
      const latestDate = new Date(selectedPricing.createdAt).getTime();
      if (!Number.isNaN(draftDate) && !Number.isNaN(latestDate) && draftDate < latestDate) {
        try {
          await customConfirm(
            `This version is dated ${formatDate(parsedPricing.pricing.createdAt!)} and the latest version of ${selectedPricing.name} is dated ${formatDate(selectedPricing.createdAt)}. It will not become this pricing's latest version. Do you want to publish it anyway?`,
            { confirmLabel: 'Publish anyway', cancelLabel: 'Go back' }
          );
        } catch {
          return;
        }
      }
    }
    setErrors([]);
    setIsPublishing(true);
    const formData = new FormData();
    formData.append(
      'yaml',
      new File([yaml], `${parsedPricing.pricing.saasName || 'pricing'}.yaml`, {
        type: 'application/x-yaml',
      })
    );
    try {
      if (destination === 'version' && selectedPricing) {
        formData.append('private', selectedPricing.private ? 'true' : 'false');
        await createPricingVersion(
          formData,
          selectedPricing.organization.id,
          selectedPricing.slug,
          parsedPricing.pricing.version
        );
        onClose();
        router.push(`/pricings/${selectedPricing.organization.id}/${selectedPricing.slug}`);
      } else if (selectedOrg) {
        formData.append('name', pricingName.trim());
        formData.append('saasName', parsedPricing.pricing.saasName);
        formData.append('version', parsedPricing.pricing.version);
        formData.append('private', visibility === 'Private' ? 'true' : 'false');
        const createdPricing = await createPricing(formData, selectedOrg.id, publishErrors =>
          setErrors(publishErrors.map(formatPublishError))
        );
        if (!createdPricing) return;
        onClose();
        router.push(`/pricings/${selectedOrg.id}/${createdPricing.slug}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The pricing could not be published.';
      setErrors(current => (current.length ? current : [formatPublishError(message)]));
    } finally {
      setIsPublishing(false);
    }
  };
  const canPublish = Boolean(
    parsedPricing.pricing &&
    !isPublishing &&
    (destination === 'version' ? selectedPricing : selectedOrg && pricingName.trim())
  );
  const totalPages = Math.max(1, Math.ceil(pricingsTotal / PRICINGS_PER_PAGE));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
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
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[42rem] flex-col overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-4 sm:max-h-[calc(100dvh-2rem)]"
        onClick={event => event.stopPropagation()}
      >
        <header className="relative shrink-0 overflow-hidden border-b border-tp-hairline bg-tp-surface px-5 py-4 sm:px-6 sm:py-5">
          <div className="absolute -right-8 -top-12 h-32 w-32 rounded-full bg-tp-primary/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tp-primary text-tp-on-primary shadow-sm">
                <FiUploadCloud className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-tp-primary">
                  Current editor draft
                </p>
                <h2
                  id="publish-pricing-title"
                  className="mt-1 font-display text-xl font-semibold text-tp-ink"
                >
                  Publish to SPHERE
                </h2>
                <p className="mt-1 text-sm leading-5 text-tp-steel">
                  Create a pricing or add this draft as a new version.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close publish dialog"
              className="cursor-pointer rounded-lg p-2 text-tp-steel transition-colors hover:bg-tp-canvas hover:text-tp-ink"
            >
              <FiX className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {parsedPricing.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">The YAML needs attention before publishing.</p>
              <p className="mt-1 text-xs leading-5 text-red-600">{parsedPricing.error}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">
                <FiCheck className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-emerald-900">YAML ready to publish</p>
                <p className="text-xs text-emerald-700">
                  {parsedPricing.pricing?.saasName} · version {parsedPricing.pricing?.version}
                </p>
              </div>
            </div>
          )}
          <fieldset>
            <legend className="mb-2 text-sm text-tp-slate">Where should this draft go?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <DestinationButton
                active={destination === 'new'}
                icon={<FiFilePlus className="h-4 w-4" />}
                title="New pricing"
                description="Create a new pricing in an organization."
                onClick={() => {
                  setDestination('new');
                  setErrors([]);
                }}
              />
              <DestinationButton
                active={destination === 'version'}
                icon={<FiUploadCloud className="h-4 w-4" />}
                title="New version"
                description="Add this draft to an existing pricing."
                onClick={() => {
                  setDestination('version');
                  setErrors([]);
                }}
              />
            </div>
          </fieldset>
          {destination === 'new' ? (
            <NewPricingFields
              selectedOrg={selectedOrg}
              organizations={organizations}
              organizationsLoading={organizationsLoading}
              pricingName={pricingName}
              visibility={visibility}
              onOrganizationChange={setSelectedOrg}
              onPricingNameChange={setPricingName}
              onVisibilityChange={setVisibility}
            />
          ) : (
            <section aria-labelledby="existing-pricing-title" className="space-y-3">
              <div>
                <h3 id="existing-pricing-title" className="text-sm font-medium text-tp-slate">
                  Choose a pricing
                </h3>
                <p className="mt-0.5 text-xs text-tp-muted">
                  The version keeps the selected pricing's organization, collection, and visibility.
                </p>
              </div>
              <div className="relative">
                <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tp-muted" />
                <input
                  value={pricingSearch}
                  onChange={event => {
                    setPricingSearch(event.target.value);
                    setPricingPage(1);
                  }}
                  placeholder="Search pricings by name…"
                  className="h-10 w-full rounded-md border border-tp-hairline-strong bg-tp-canvas py-2 pl-9 pr-3 text-sm text-tp-ink outline-none transition-colors placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
                />
              </div>
              {matchingPricings.length > 0 && !pricingSearch ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-tp-primary">
                    Matches this draft
                  </p>
                  {matchingPricings.map(pricing => (
                    <PricingTarget
                      key={`match-${pricing.id}`}
                      pricing={pricing}
                      selected={selectedPricing?.id === pricing.id}
                      onSelect={selectPricing}
                    />
                  ))}
                </div>
              ) : null}
              <div className="space-y-2">
                {matchingPricings.length > 0 && !pricingSearch ? (
                  <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-tp-muted">
                    All accessible pricings
                  </p>
                ) : null}
                {pricingsLoading ? (
                  <EmptyState>Loading pricings…</EmptyState>
                ) : pricingsError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {pricingsError}
                  </div>
                ) : pricings.length === 0 ? (
                  <EmptyState>No accessible pricings match this search.</EmptyState>
                ) : (
                  pricings.map(pricing => (
                    <PricingTarget
                      key={pricing.id}
                      pricing={pricing}
                      selected={selectedPricing?.id === pricing.id}
                      onSelect={selectPricing}
                    />
                  ))
                )}
              </div>
              {pricingsTotal > PRICINGS_PER_PAGE ? (
                <Pagination
                  currentPage={pricingPage}
                  totalPages={totalPages}
                  onPageChange={setPricingPage}
                />
              ) : null}
            </section>
          )}
          <AnimatePresence>
            {errors.length > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3"
                role="alert"
              >
                {errors.map(error => (
                  <p key={error} className="text-xs leading-5 text-red-700">
                    {error}
                  </p>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </main>
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-tp-hairline bg-tp-surface px-5 py-3 sm:px-6 sm:py-4">
          <p className="hidden text-xs text-tp-muted sm:block">
            {destination === 'version'
              ? selectedPricing
                ? `Adding a version to ${selectedPricing.name}.`
                : 'Select a pricing to add a version.'
              : 'A new pricing will be created in the selected organization.'}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-tp-slate transition-colors hover:bg-tp-canvas hover:text-tp-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={!canPublish}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-tp-primary px-4 py-2 text-sm font-semibold text-tp-on-primary transition-all hover:bg-tp-primary-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isPublishing
                ? 'Publishing…'
                : destination === 'version'
                  ? 'Publish version'
                  : 'Publish'}
              {!isPublishing ? <FiArrowUpRight className="h-4 w-4" /> : null}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}

function DestinationButton({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors ${active ? 'border-tp-primary bg-tp-primary/5' : 'border-tp-hairline-strong hover:border-tp-primary/40'}`}
    >
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-tp-primary text-tp-on-primary' : 'bg-tp-surface text-tp-steel'}`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-tp-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-tp-steel">{description}</span>
      </span>
    </button>
  );
}
function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-6 text-center text-sm text-tp-muted">
      {children}
    </div>
  );
}
function PricingTarget({
  pricing,
  selected,
  onSelect,
}: {
  pricing: AccessiblePricing;
  selected: boolean;
  onSelect: (pricing: AccessiblePricing) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pricing)}
      aria-pressed={selected}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${selected ? 'border-tp-primary bg-tp-primary/5 shadow-sm' : 'border-tp-hairline-strong bg-tp-canvas hover:border-tp-primary/40 hover:bg-tp-surface'}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-tp-primary bg-tp-primary' : 'border-tp-hairline-strong'}`}
      >
        {selected ? <FiCheck className="h-3 w-3 text-tp-on-primary" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-tp-ink">{pricing.name}</span>
        <span className="mt-0.5 block truncate text-xs text-tp-steel">
          {pricing.organization.displayName || pricing.organization.name} · v{pricing.version} ·{' '}
          {formatDate(pricing.createdAt)}
        </span>
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pricing.private ? 'bg-tp-surface text-tp-steel' : 'bg-emerald-50 text-emerald-700'}`}
      >
        {pricing.private ? 'Private' : 'Public'}
      </span>
    </button>
  );
}
function NewPricingFields({
  selectedOrg,
  organizations,
  organizationsLoading,
  pricingName,
  visibility,
  onOrganizationChange,
  onPricingNameChange,
  onVisibilityChange,
}: {
  selectedOrg: Organization | null;
  organizations: Organization[];
  organizationsLoading: boolean;
  pricingName: string;
  visibility: 'Public' | 'Private';
  onOrganizationChange: (org: Organization | null) => void;
  onPricingNameChange: (name: string) => void;
  onVisibilityChange: (visibility: 'Public' | 'Private') => void;
}) {
  return (
    <>
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
            onChange={event =>
              onOrganizationChange(organizations.find(org => org.id === event.target.value) ?? null)
            }
            disabled={organizationsLoading}
            className={`h-11 w-full cursor-pointer appearance-none rounded-md border border-tp-hairline-strong bg-tp-canvas pr-10 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10 disabled:cursor-wait disabled:opacity-60 ${selectedOrg ? 'pl-11' : 'pl-3'}`}
          >
            <option value="">
              {organizationsLoading ? 'Loading organizations…' : 'Select an organization'}
            </option>
            {organizations.map(org => (
              <option key={org.id} value={org.id}>
                {org.displayName} · {org.role ?? 'MEMBER'}
              </option>
            ))}
          </select>
        </span>
        {!organizationsLoading && organizations.length === 0 ? (
          <span className="mt-1.5 block text-xs text-amber-700">
            You need an organization before you can publish a pricing.
          </span>
        ) : null}
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-tp-slate">Pricing name</span>
        <input
          value={pricingName}
          onChange={event => onPricingNameChange(event.target.value)}
          placeholder="e.g. Clockify"
          className="h-10 w-full rounded-md border border-tp-hairline-strong bg-tp-canvas px-3 text-sm text-tp-ink outline-none transition-colors placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
        />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm text-tp-slate">Visibility</legend>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-tp-surface p-1.5">
          {[
            {
              value: 'Public' as const,
              label: 'Public',
              description: 'Visible in Explore',
              icon: FiGlobe,
            },
            {
              value: 'Private' as const,
              label: 'Private',
              description: 'Organization only',
              icon: FiLock,
            },
          ].map(option => {
            const Icon = option.icon;
            const selected = visibility === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onVisibilityChange(option.value)}
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
    </>
  );
}
