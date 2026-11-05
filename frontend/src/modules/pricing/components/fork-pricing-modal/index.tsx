import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import OrganizationSelector from '../organization-selector';
import {
  useOrganizationsApi,
  type Organization,
  type OrgPricing,
} from '../../../organization/api/organizationsApi';
import { suggestVersionName, VERSION_LABEL } from '../../utils/version-graph';

interface ForkPricingModalProps {
  pricingName: string;
  /** The pricing and version being forked, to leave it out of the targets and name the copy. */
  sourceOrganizationId: string;
  sourceSlug: string;
  sourceVersion: string;
  onFork: (targetOrganizationId: string, name?: string) => Promise<any>;
  /** Adds the version to an existing pricing instead, under the name given. */
  onForkInto: (
    targetOrganizationId: string,
    targetSlug: string,
    versionName: string
  ) => Promise<any>;
  onClose: () => void;
  onSuccess: (result: { slug: string; _organizationId: string }) => void;
}

type Destination = 'new' | 'existing';

const secondaryButton =
  'cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface';
const primaryButton =
  'cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-40';
const fieldClass =
  'w-full rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm text-tp-ink outline-none focus:border-tp-primary';

export default function ForkPricingModal({
  pricingName,
  sourceOrganizationId,
  sourceSlug,
  sourceVersion,
  onFork,
  onForkInto,
  onClose,
  onSuccess,
}: ForkPricingModalProps) {
  const { getOrgPricings } = useOrganizationsApi();
  const [targetOrg, setTargetOrg] = useState<Organization | null>(null);
  const [destination, setDestination] = useState<Destination>('new');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // A new pricing must not take the name of one the organization already has.
  const nameIsTaken =
    takenName !== null && newName.trim().toLowerCase() === takenName.trim().toLowerCase();

  // Adding to an existing pricing: the organization's pricings, the one picked and the version's name.
  const [pricings, setPricings] = useState<OrgPricing[] | null>(null);
  const [targetSlug, setTargetSlug] = useState('');
  const [versionName, setVersionName] = useState('');
  const target = pricings?.find(pricing => pricing.slug === targetSlug) ?? null;
  const versionTrimmed = versionName.trim();
  const versionProblem = !versionTrimmed
    ? 'Name the version'
    : !VERSION_LABEL.test(versionTrimmed)
      ? 'Use letters, digits, ".", "_", "+" or "-", starting with a letter or digit'
      : target && target.version === versionTrimmed
        ? `${target.name} already has a version ${versionTrimmed}`
        : null;

  useEffect(() => {
    if (destination !== 'existing' || !targetOrg) return;
    const controller = new AbortController();
    setPricings(null);
    getOrgPricings(targetOrg.id, { limit: '100' }, controller.signal)
      .then(result =>
        setPricings(
          result.pricings.filter(
            pricing => !(targetOrg.id === sourceOrganizationId && pricing.slug === sourceSlug)
          )
        )
      )
      .catch(err => {
        if ((err as Error).name !== 'AbortError') setPricings([]);
      });
    return () => controller.abort();
  }, [destination, targetOrg, getOrgPricings, sourceOrganizationId, sourceSlug]);

  // The name offered follows the pricing picked: the next minor version after its latest one.
  useEffect(() => {
    if (target) setVersionName(suggestVersionName([target.version], sourceVersion));
  }, [target, sourceVersion]);

  const run = async (action: () => Promise<any>) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await action();
      if (result?.nameTaken) {
        setTakenName(result.existingPricing.name);
        setNewName(`${result.existingPricing.name} (fork)`);
        setTargetSlug(result.existingPricing.slug);
      } else {
        onSuccess(result);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!targetOrg) return;
    if (destination === 'existing') {
      if (!target || versionProblem) return;
      void run(() => onForkInto(targetOrg.id, target.slug, versionTrimmed));
    } else {
      void run(() => onFork(targetOrg.id));
    }
  };

  const content =
    takenName === null ? (
      <>
        <h2 className="mb-2 text-center font-display text-lg font-semibold text-tp-ink">
          Fork this pricing
        </h2>
        <p className="mb-4 text-center text-sm text-tp-steel">
          Copy version <span className="font-medium text-tp-ink">{sourceVersion}</span> of{' '}
          <span className="font-medium text-tp-ink">{pricingName}</span> into one of your
          organizations.
        </p>
        <OrganizationSelector value={targetOrg} onChange={setTargetOrg} />

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-xs font-medium text-tp-slate">As</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['new', 'A new pricing', 'Its own copy, with this version'],
                ['existing', 'A new version', 'Of a pricing it already has'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
                  destination === value
                    ? 'border-tp-primary bg-tp-primary/5'
                    : 'border-tp-hairline-strong hover:border-tp-primary/40'
                }`}
              >
                <input
                  type="radio"
                  name="fork-destination"
                  value={value}
                  checked={destination === value}
                  onChange={() => setDestination(value)}
                  className="sr-only"
                />
                <span className="block text-sm font-medium text-tp-ink">{label}</span>
                <span className="block text-[11px] text-tp-steel">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {destination === 'existing' && targetOrg && (
          <div className="mt-4 grid gap-3">
            <div>
              <label
                htmlFor="fork-target-pricing"
                className="mb-1 block text-xs font-medium text-tp-slate"
              >
                Pricing
              </label>
              {pricings === null ? (
                <div className="h-9 animate-pulse rounded-lg bg-tp-surface" />
              ) : pricings.length === 0 ? (
                <p className="text-xs text-tp-steel">
                  {targetOrg.displayName} has no other pricings you can add to.
                </p>
              ) : (
                <select
                  id="fork-target-pricing"
                  value={targetSlug}
                  onChange={e => setTargetSlug(e.target.value)}
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="" disabled>
                    Pick a pricing
                  </option>
                  {pricings.map(pricing => (
                    <option key={pricing.slug} value={pricing.slug}>
                      {pricing.name} (latest {pricing.version})
                    </option>
                  ))}
                </select>
              )}
            </div>
            {target && (
              <>
                <div>
                  <label
                    htmlFor="fork-version-name"
                    className="mb-1 block text-xs font-medium text-tp-slate"
                  >
                    Name of the forked version
                  </label>
                  <input
                    id="fork-version-name"
                    value={versionName}
                    maxLength={64}
                    onChange={e => setVersionName(e.target.value)}
                    aria-invalid={versionProblem !== null}
                    className={`${fieldClass} font-mono`}
                  />
                  {versionProblem && versionTrimmed && (
                    <p className="mt-1 text-xs text-tp-severity-error">{versionProblem}</p>
                  )}
                </div>
                <p className="rounded-lg border border-tp-primary/30 bg-tp-primary/5 px-3 py-2.5 text-xs text-tp-ink">
                  It will be saved as the latest version of{' '}
                  <span className="font-semibold">{target.name}</span>
                  {versionTrimmed && !versionProblem ? (
                    <>
                      {' '}
                      under the name{' '}
                      <span className="font-mono font-semibold">{versionTrimmed}</span>
                    </>
                  ) : null}
                  .
                </p>
              </>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-center text-xs text-tp-severity-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="button"
            disabled={
              !targetOrg ||
              isSubmitting ||
              (destination === 'existing' && (!target || versionProblem !== null))
            }
            onClick={handleSubmit}
            className={primaryButton}
          >
            {isSubmitting
              ? 'Forking…'
              : destination === 'existing'
                ? 'Fork as latest version'
                : 'Fork'}
          </button>
        </div>
      </>
    ) : (
      <>
        <h2 className="mb-2 text-center font-display text-lg font-semibold text-tp-ink">
          {targetOrg?.displayName} already has “{takenName}”
        </h2>
        <p className="mb-4 text-center text-sm text-tp-steel">
          Fork it as a new pricing with another name, or add this version to{' '}
          <span className="font-medium text-tp-ink">{takenName}</span> as its latest version.
        </p>
        <label htmlFor="fork-new-name" className="mb-1 block text-xs font-medium text-tp-slate">
          New pricing name
        </label>
        <input
          id="fork-new-name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className={fieldClass}
        />
        {error && <p className="mt-3 text-center text-xs text-tp-severity-error">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setTakenName(null)} className={secondaryButton}>
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              setTakenName(null);
              setDestination('existing');
            }}
            className={secondaryButton}
          >
            Add as a new version
          </button>
          <button
            type="button"
            disabled={isSubmitting || !newName.trim() || nameIsTaken}
            onClick={() =>
              targetOrg && void run(() => onFork(targetOrg.id, newName.trim() || undefined))
            }
            className={primaryButton}
          >
            {isSubmitting ? 'Forking…' : 'Fork as new pricing'}
          </button>
        </div>
      </>
    );

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
        className="w-full max-w-[28rem] cursor-default rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
        onClick={e => e.stopPropagation()}
      >
        {content}
      </motion.div>
    </motion.div>
  );
}
