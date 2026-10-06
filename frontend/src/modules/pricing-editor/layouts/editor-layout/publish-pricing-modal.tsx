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
import { Organization, useOrganizationsApi } from '../../../organization/api/organizationsApi';
import { useRouter } from '../../../core/hooks/useRouter';
import OrgAvatar from '../../../core/components/org-avatar';
import customConfirm from '../../../core/utils/custom-confirm';
import { useEditorValue } from '../../hooks/useEditorValue';
import { stampVersionMetadata, toDatetimeLocalValue } from '../../utils/publish-metadata';

interface PublishPricingModalProps {
  yaml: string;
  onClose: () => void;
}
type Visibility = 'Public' | 'Private';
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

const MAX_RESULTS = 5;
const flattenOrganizations = (organizations: Organization[]): Organization[] =>
  organizations.flatMap(org => [org, ...flattenOrganizations(org.subOrganizations ?? [])]);
const formatPublishError = (message: string) =>
  message.replace(/^(CONFLICT|INVALID DATA):\s*/i, '');
const formatDate = (date: string | Date) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? String(date)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
};
const sameName = (pricing: AccessiblePricing, name?: string) =>
  pricing.name.trim().toLowerCase() === name?.trim().toLowerCase();

export default function PublishPricingModal({ yaml, onClose }: PublishPricingModalProps) {
  const router = useRouter();
  const { createPricing, createPricingVersion, getPermissionBasedUserPricings, getPricingBySlug } = usePricingsApi();
  const { sourcePricing } = useEditorValue();
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
  const [visibility, setVisibility] = useState<Visibility>('Public');
  const [versionVisibility, setVersionVisibility] = useState<Visibility>('Public');
  const [destination, setDestination] = useState<'new' | 'version'>('new');
  const [selectedPricing, setSelectedPricing] = useState<AccessiblePricing | null>(null);
  const [matchingPricings, setMatchingPricings] = useState<AccessiblePricing[]>([]);
  const [pricings, setPricings] = useState<AccessiblePricing[]>([]);
  const [pricingsTotal, setPricingsTotal] = useState(0);
  const [pricingSearch, setPricingSearch] = useState('');
  const deferredSearch = useDeferredValue(pricingSearch);
  const [pricingsLoading, setPricingsLoading] = useState(true);
  const [pricingsError, setPricingsError] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const didSetDefaultPricing = useRef(false);
  const [versionName, setVersionName] = useState('');
  const [versionNameEdited, setVersionNameEdited] = useState(false);
  const [releaseAt, setReleaseAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [releaseAtEdited, setReleaseAtEdited] = useState(false);
  const [existingVersions, setExistingVersions] = useState<string[]>([]);

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
      limit: MAX_RESULTS,
      offset: 0,
      name: deferredSearch.trim(),
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
  }, [deferredSearch, getPermissionBasedUserPricings]);

  useEffect(() => {
    const saasName = parsedPricing.pricing?.saasName;
    if (!saasName) return;
    let active = true;
    getPermissionBasedUserPricings({ name: saasName, limit: MAX_RESULTS, offset: 0 })
      .then(result => {
        if (!active) return;
        const exactMatches = (result.pricings ?? []).filter((pricing: AccessiblePricing) =>
          sameName(pricing, saasName)
        );
        setMatchingPricings(exactMatches);
        if (!sourcePricing && !didSetDefaultPricing.current && exactMatches.length === 1) {
          didSetDefaultPricing.current = true;
          setSelectedPricing(exactMatches[0]);
          setVersionVisibility(exactMatches[0].private ? 'Private' : 'Public');
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

  // Opened from a published pricing: the new version goes back to that pricing.
  useEffect(() => {
    if (!sourcePricing) return;
    let active = true;
    getPermissionBasedUserPricings({ name: sourcePricing.name, limit: 20, offset: 0 })
      .then(result => {
        if (!active) return;
        const source = (result.pricings ?? []).find(
          (pricing: AccessiblePricing) =>
            pricing.slug === sourcePricing.slug &&
            pricing.organization.id === sourcePricing.organizationId
        );
        if (source && !didSetDefaultPricing.current) {
          didSetDefaultPricing.current = true;
          setSelectedPricing(source);
          setVersionVisibility(source.private ? 'Private' : 'Public');
          setDestination('version');
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [getPermissionBasedUserPricings, sourcePricing]);

  // Versions already published on the destination, to flag a clash before sending.
  useEffect(() => {
    if (!selectedPricing) {
      setExistingVersions([]);
      return;
    }
    let active = true;
    getPricingBySlug(selectedPricing.slug, selectedPricing.organization.id, selectedPricing.collection?.slug ?? null)
      .then(data => {
        if (active) setExistingVersions((data.versions ?? []).map((v: { version: string }) => v.version));
      })
      .catch(() => {
        if (active) setExistingVersions([]);
      });
    return () => {
      active = false;
    };
  }, [getPricingBySlug, selectedPricing]);

  // The version the draft started from: the one opened in the editor when it
  // belongs to the destination, otherwise the destination's latest.
  const cameFromSelected =
    !!sourcePricing &&
    !!selectedPricing &&
    sourcePricing.slug === selectedPricing.slug &&
    sourcePricing.organizationId === selectedPricing.organization.id;
  const baseVersion = cameFromSelected ? sourcePricing!.version : selectedPricing?.version;
  const draftVersion = parsedPricing.pricing?.version ?? '';
  const versionChanged = !!baseVersion && !!draftVersion && draftVersion !== baseVersion;

  useEffect(() => {
    if (versionNameEdited) return;
    setVersionName(versionChanged ? draftVersion : '');
  }, [versionChanged, draftVersion, versionNameEdited]);

  const trimmedVersionName = versionName.trim();
  const versionNameError = !selectedPricing || !trimmedVersionName
    ? ''
    : existingVersions.includes(trimmedVersionName)
      ? `Version "${trimmedVersionName}" already exists in ${selectedPricing.name}.`
      : '';
  const releaseDate = releaseAtEdited ? new Date(releaseAt) : null;
  const releaseDateError = releaseDate && (Number.isNaN(releaseDate.getTime()) || releaseDate.getTime() > Date.now())
    ? 'The release date must be a valid date and time that is not in the future.'
    : '';

  const selectPricing = (pricing: AccessiblePricing) => {
    setSelectedPricing(pricing);
    setVersionVisibility(pricing.private ? 'Private' : 'Public');
    setDestination('version');
    setErrors([]);
  };
  const clearSelectedPricing = () => {
    setSelectedPricing(null);
    setPricingSearch('');
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
      const draftDate = (releaseDate ?? new Date()).getTime();
      const latestDate = new Date(selectedPricing.createdAt).getTime();
      if (!Number.isNaN(draftDate) && !Number.isNaN(latestDate) && draftDate < latestDate) {
        try {
          await customConfirm(
            `This version is dated ${formatDate(releaseDate ?? new Date())} and the latest version of ${selectedPricing.name} is dated ${formatDate(selectedPricing.createdAt)}. It will not become this pricing's latest version. Do you want to publish it anyway?`,
            { confirmLabel: 'Publish anyway', cancelLabel: 'Go back' }
          );
        } catch {
          return;
        }
      }
    }
    setErrors([]);
    setIsPublishing(true);
    // A version released "now" takes the exact instant of publishing, so several
    // versions published within one day (or minute) keep their order.
    const publishedAt = releaseDate ?? new Date();
    const versionYaml =
      destination === 'version' ? stampVersionMetadata(yaml, trimmedVersionName, publishedAt) : yaml;
    const formData = new FormData();
    formData.append(
      'yaml',
      new File([versionYaml], `${parsedPricing.pricing.saasName || 'pricing'}.yaml`, {
        type: 'application/x-yaml',
      })
    );
    try {
      if (destination === 'version' && selectedPricing) {
        // Multer needs the text fields before the file to place it, so the
        // file is re-appended last.
        const file = formData.get('yaml') as File;
        formData.delete('yaml');
        formData.append('private', versionVisibility === 'Private' ? 'true' : 'false');
        formData.append('createdAt', publishedAt.toISOString());
        formData.append('yaml', file);
        await createPricingVersion(
          formData,
          selectedPricing.organization.id,
          selectedPricing.slug,
          trimmedVersionName
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
    (destination === 'version'
      ? selectedPricing && trimmedVersionName && !versionNameError && !releaseDateError
      : selectedOrg && pricingName.trim())
  );
  const searchTerm = pricingSearch.trim();
  const draftMatchIds = new Set(matchingPricings.map(pricing => pricing.id));
  // With nothing typed, the pricings named like the draft come first.
  const results = searchTerm
    ? pricings
    : [...matchingPricings, ...pricings.filter(pricing => !draftMatchIds.has(pricing.id))].slice(
        0,
        MAX_RESULTS
      );
  const hiddenResults = Math.max(0, pricingsTotal - results.length);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 pt-[8dvh] backdrop-blur-sm sm:p-4 sm:pt-[10dvh]"
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
        className="flex max-h-[calc(92dvh-0.75rem)] w-full max-w-[42rem] flex-col overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-4 sm:max-h-[calc(90dvh-1rem)]"
        onClick={event => event.stopPropagation()}
      >
        <header className="relative shrink-0 overflow-hidden border-b border-tp-hairline bg-tp-surface px-5 py-3.5 sm:px-6">
          <div className="absolute -right-8 -top-12 h-32 w-32 rounded-full bg-tp-primary/10 blur-2xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tp-primary text-tp-on-primary shadow-sm">
                <FiUploadCloud className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h2
                  id="publish-pricing-title"
                  className="font-display text-lg font-semibold leading-tight text-tp-ink"
                >
                  Publish to SPHERE
                </h2>
                {parsedPricing.pricing ? (
                  <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-tp-steel">
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                      <FiCheck className="h-2.5 w-2.5" />
                    </span>
                    <span className="truncate">
                      <span className="font-medium text-tp-ink">
                        {parsedPricing.pricing.saasName}
                      </span>{' '}
                      · v{parsedPricing.pricing.version} · ready to publish
                    </span>
                  </p>
                ) : null}
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
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
          <AnimatedHeight>
            <div className="space-y-4">
              {parsedPricing.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p className="font-medium">The YAML needs attention before publishing.</p>
                  <p className="mt-1 text-xs leading-5 text-red-600">{parsedPricing.error}</p>
                </div>
              ) : null}
              <fieldset>
                <legend className="sr-only">Where should this draft go?</legend>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-tp-surface p-1">
                  <DestinationButton
                    active={destination === 'new'}
                    icon={<FiFilePlus className="h-4 w-4" />}
                    title="New pricing"
                    onClick={() => {
                      setDestination('new');
                      setErrors([]);
                    }}
                  />
                  <DestinationButton
                    active={destination === 'version'}
                    icon={<FiUploadCloud className="h-4 w-4" />}
                    title="New version"
                    onClick={() => {
                      setDestination('version');
                      setErrors([]);
                    }}
                  />
                </div>
                <p className="mt-1.5 px-1 text-xs text-tp-muted">
                  {destination === 'new'
                    ? 'Create a new pricing in one of your organizations.'
                    : 'Add this draft as a new version of an existing pricing.'}
                </p>
              </fieldset>
              <motion.div
                key={destination}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
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
                  <section aria-labelledby="existing-pricing-title" className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <h3
                          id="existing-pricing-title"
                          className="text-sm font-medium text-tp-slate"
                        >
                          Choose a pricing
                        </h3>
                        <p className="mt-0.5 text-xs text-tp-muted">
                          The version keeps the selected pricing's organization and collection.
                        </p>
                      </div>
                      <motion.div
                        key={selectedPricing ? 'selected' : 'search'}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                        className="space-y-3"
                      >
                        {selectedPricing ? (
                          <SelectedPricing
                            pricing={selectedPricing}
                            onChange={clearSelectedPricing}
                          />
                        ) : (
                          <>
                            <div className="relative">
                              <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tp-muted" />
                              <input
                                value={pricingSearch}
                                onChange={event => setPricingSearch(event.target.value)}
                                onKeyDown={event => {
                                  if (event.key === 'Enter' && results[0]) {
                                    event.preventDefault();
                                    selectPricing(results[0]);
                                  }
                                }}
                                role="combobox"
                                aria-expanded="true"
                                aria-controls="pricing-results"
                                aria-label="Search pricings by name"
                                placeholder="Type to search your pricings…"
                                className="h-10 w-full rounded-md border border-tp-hairline-strong bg-tp-canvas py-2 pl-9 pr-3 text-sm text-tp-ink outline-none transition-colors placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
                              />
                            </div>
                            <div id="pricing-results" role="listbox" className="space-y-2">
                              {pricingsLoading && results.length === 0 ? (
                                <EmptyState>Loading pricings…</EmptyState>
                              ) : pricingsError ? (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                  {pricingsError}
                                </div>
                              ) : results.length === 0 ? (
                                <EmptyState>
                                  {searchTerm
                                    ? `No accessible pricings match "${searchTerm}".`
                                    : 'You have no accessible pricings yet.'}
                                </EmptyState>
                              ) : (
                                results.map(pricing => (
                                  <PricingTarget
                                    key={pricing.id}
                                    pricing={pricing}
                                    highlight={!searchTerm && draftMatchIds.has(pricing.id)}
                                    onSelect={selectPricing}
                                  />
                                ))
                              )}
                            </div>
                            {hiddenResults > 0 ? (
                              <p className="text-center text-xs text-tp-muted">
                                {hiddenResults} more {hiddenResults === 1 ? 'pricing' : 'pricings'}{' '}
                                — keep typing to narrow the list.
                              </p>
                            ) : null}
                          </>
                        )}
                      </motion.div>
                    </div>
                    {selectedPricing ? (
                      <VisibilityPicker
                        value={versionVisibility}
                        onChange={setVersionVisibility}
                        hint={
                          (versionVisibility === 'Private') !== selectedPricing.private
                            ? `This version will be ${versionVisibility.toLowerCase()}; the latest version of this pricing is ${selectedPricing.private ? 'private' : 'public'}.`
                            : undefined
                        }
                      />
                    ) : null}
                    {selectedPricing ? (
                      <VersionDetails
                        versionName={versionName}
                        onVersionNameChange={value => {
                          setVersionName(value);
                          setVersionNameEdited(true);
                        }}
                        versionDetected={versionChanged && !versionNameEdited}
                        baseVersion={baseVersion}
                        versionError={versionNameError}
                        releaseAt={releaseAt}
                        onReleaseAtChange={value => {
                          setReleaseAt(value);
                          setReleaseAtEdited(true);
                        }}
                        releaseAtEdited={releaseAtEdited}
                        releaseError={releaseDateError}
                      />
                    ) : null}
                  </section>
                )}
              </motion.div>
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
            </div>
          </AnimatedHeight>
        </main>
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-tp-hairline bg-tp-surface px-5 py-3 sm:px-6">
          <p className="hidden text-xs text-tp-muted sm:block">
            {destination === 'version'
              ? selectedPricing
                ? `Adding a ${versionVisibility.toLowerCase()} version to ${selectedPricing.name}.`
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

/**
 * Animates its own height to follow the content, so switching tabs or picking a
 * pricing grows and shrinks the dialog smoothly instead of snapping. The small
 * negative margin keeps focus rings from being clipped by `overflow-hidden`.
 */
function AnimatedHeight({ children }: { children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    // + 8: the wrapper's `p-1` on both sides.
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height + 8));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="-m-1 overflow-hidden p-1"
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
}
function DestinationButton({
  active,
  icon,
  title,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${active ? 'border-tp-primary/30 bg-tp-canvas text-tp-ink shadow-sm' : 'border-transparent text-tp-steel hover:text-tp-ink'}`}
    >
      <span className={active ? 'text-tp-primary' : ''}>{icon}</span>
      {title}
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
  highlight = false,
  onSelect,
}: {
  pricing: AccessiblePricing;
  highlight?: boolean;
  onSelect: (pricing: AccessiblePricing) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected="false"
      onClick={() => onSelect(pricing)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-tp-hairline bg-tp-canvas px-3 py-2 text-left transition-colors hover:border-tp-primary/40 hover:bg-tp-surface"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-tp-ink">{pricing.name}</span>
        <span className="mt-0.5 block truncate text-xs text-tp-steel">
          {pricing.organization.displayName || pricing.organization.name} · v{pricing.version} ·{' '}
          {formatDate(pricing.createdAt)}
        </span>
      </span>
      {highlight ? (
        <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[10px] font-medium text-tp-primary">
          Matches draft
        </span>
      ) : null}
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pricing.private ? 'bg-tp-surface text-tp-steel' : 'bg-emerald-50 text-emerald-700'}`}
      >
        {pricing.private ? 'Private' : 'Public'}
      </span>
    </button>
  );
}
function SelectedPricing({
  pricing,
  onChange,
}: {
  pricing: AccessiblePricing;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tp-primary bg-tp-primary/5 px-3 py-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tp-primary text-tp-on-primary">
        <FiCheck className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-tp-ink">{pricing.name}</span>
        <span className="mt-0.5 block truncate text-xs text-tp-steel">
          {pricing.organization.displayName || pricing.organization.name} · latest v
          {pricing.version} · {formatDate(pricing.createdAt)}
        </span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-tp-primary transition-colors hover:bg-tp-primary/10"
      >
        Change
      </button>
    </div>
  );
}
function VersionDetails({
  versionName,
  onVersionNameChange,
  versionDetected,
  baseVersion,
  versionError,
  releaseAt,
  onReleaseAtChange,
  releaseAtEdited,
  releaseError,
}: {
  versionName: string;
  onVersionNameChange: (value: string) => void;
  versionDetected: boolean;
  baseVersion?: string;
  versionError: string;
  releaseAt: string;
  onReleaseAtChange: (value: string) => void;
  releaseAtEdited: boolean;
  releaseError: string;
}) {
  const inputClass =
    'h-10 w-full rounded-md border border-tp-hairline-strong bg-tp-canvas px-3 text-sm text-tp-ink outline-none transition-colors placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10';
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 text-sm text-tp-slate">Version details</legend>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-tp-slate">Version name</span>
        <input
          value={versionName}
          onChange={event => onVersionNameChange(event.target.value)}
          placeholder={baseVersion ? `e.g. a new name after ${baseVersion}` : 'e.g. 2.0.0'}
          aria-invalid={Boolean(versionError)}
          className={inputClass}
        />
        {versionError ? (
          <span className="mt-1 block text-xs text-red-600">{versionError}</span>
        ) : (
          <span className="mt-1 block text-xs text-tp-muted">
            {versionDetected
              ? `Taken from the version you set in the editor (the pricing started at ${baseVersion}).`
              : versionName
                ? ''
                : `The version was not changed from ${baseVersion}. Name this new version.`}
          </span>
        )}
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-tp-slate">Release date</span>
        <input
          type="datetime-local"
          value={releaseAt}
          max={toDatetimeLocalValue(new Date())}
          onChange={event => onReleaseAtChange(event.target.value)}
          className={inputClass}
        />
        {releaseError ? (
          <span className="mt-1 block text-xs text-red-600">{releaseError}</span>
        ) : (
          <span className="mt-1 block text-xs text-tp-muted">
            {releaseAtEdited
              ? 'The release date and time you chose.'
              : 'Set to today, to the moment you publish, so this becomes the latest version. Change it if needed.'}
          </span>
        )}
      </label>
    </fieldset>
  );
}
function VisibilityPicker({
  value,
  onChange,
  hint,
}: {
  value: Visibility;
  onChange: (visibility: Visibility) => void;
  hint?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm text-tp-slate">Visibility</legend>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-tp-surface p-1">
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
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${selected ? 'border-tp-primary/30 bg-tp-canvas text-tp-ink shadow-sm' : 'border-transparent text-tp-steel hover:text-tp-ink'}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-tp-primary' : ''}`} />
              <span>
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="block text-[10px] text-tp-muted">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      {hint ? <p className="mt-1.5 text-xs text-amber-700">{hint}</p> : null}
    </fieldset>
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
  visibility: Visibility;
  onOrganizationChange: (org: Organization | null) => void;
  onPricingNameChange: (name: string) => void;
  onVisibilityChange: (visibility: Visibility) => void;
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
      <VisibilityPicker value={visibility} onChange={onVisibilityChange} />
    </>
  );
}
