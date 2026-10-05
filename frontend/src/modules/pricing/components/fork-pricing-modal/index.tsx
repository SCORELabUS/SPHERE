import { useState } from 'react';
import { motion } from 'framer-motion';
import OrganizationSelector from '../organization-selector';
import type { Organization } from '../../../organization/api/organizationsApi';

interface ForkPricingModalProps {
  pricingName: string;
  onFork: (targetOrganizationId: string, name?: string) => Promise<any>;
  onClose: () => void;
  onSuccess: (result: { slug: string; _organizationId: string }) => void;
}

export default function ForkPricingModal({ pricingName, onFork, onClose, onSuccess }: ForkPricingModalProps) {
  const [targetOrg, setTargetOrg] = useState<Organization | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // A fork is always a new pricing, so the name must differ from the one already taken.
  const nameIsTaken = takenName !== null && newName.trim().toLowerCase() === takenName.trim().toLowerCase();

  const handleFork = async () => {
    if (!targetOrg) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onFork(targetOrg.id);
      if (result?.nameTaken) {
        setTakenName(result.existingPricing.name);
        setNewName(`${result.existingPricing.name} (fork)`);
      } else {
        onSuccess(result);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForkWithName = async () => {
    if (!targetOrg) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onFork(targetOrg.id, newName.trim() || undefined);
      onSuccess(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
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
        className="w-full max-w-[28rem] cursor-default rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
        onClick={e => e.stopPropagation()}
      >
        {takenName === null ? (
          <>
            <h2 className="mb-2 text-center font-display text-lg font-semibold text-tp-ink">Fork this pricing</h2>
            <p className="mb-4 text-center text-sm text-tp-steel">
              Create your own copy of <span className="font-medium text-tp-ink">{pricingName}</span> in one of your organizations.
            </p>
            <OrganizationSelector value={targetOrg} onChange={setTargetOrg} />
            {error && <p className="mt-3 text-center text-xs text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!targetOrg || isSubmitting}
                onClick={handleFork}
                className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-40"
              >
                {isSubmitting ? 'Forking…' : 'Fork'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-center font-display text-lg font-semibold text-tp-ink">Choose a different name</h2>
            <p className="mb-4 text-center text-sm text-tp-steel">
              {targetOrg?.displayName} already has a pricing named{' '}
              <span className="font-medium text-tp-ink">"{takenName}"</span>. A fork always creates a new pricing and
              cannot be added to an existing one, so enter a different name for it.
            </p>
            <label className="mb-1 block text-sm text-slate-700">Pricing name</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-tp-primary"
            />
            {error && <p className="mt-3 text-center text-xs text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTakenName(null)}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
              >
                Back
              </button>
              <button
                type="button"
                disabled={isSubmitting || !newName.trim() || nameIsTaken}
                onClick={handleForkWithName}
                className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-40"
              >
                {isSubmitting ? 'Forking…' : 'Fork as new pricing'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
