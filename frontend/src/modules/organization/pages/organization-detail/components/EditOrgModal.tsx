import { useState } from 'react';
import { motion } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import { transitionFast } from '../../../../core/utils/motion-variants';
import customAlert from '../../../../core/utils/custom-alert';
import { Organization, useOrganizationsApi } from '../../../api/organizationsApi';

interface Props {
  org: Organization;
  onClose: () => void;
  onSaved: (updated: Organization) => void;
}

export default function EditOrgModal({ org, onClose, onSaved }: Props) {
  const [displayName, setDisplayName] = useState(org.displayName);
  const [description, setDescription] = useState(org.description ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const { updateOrganization } = useOrganizationsApi();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    updateOrganization(org.id, { displayName, description: description || null })
      .then((updated) => { onSaved(updated); onClose(); })
      .catch((err: Error) => { customAlert(err.message, 'error'); setIsSaving(false); });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-tp-ink/30 p-4 backdrop-blur-sm sm:p-0"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={transitionFast}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-112 rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl text-tp-ink">Edit Organization</h2>
          <button onClick={onClose} className="cursor-pointer text-tp-steel transition-colors hover:text-tp-ink">
            <Iconify icon="mdi:close" width={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-tp-steel">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={255}
              className="rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-tp-steel">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              className="rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20"
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="cursor-pointer rounded-lg border border-tp-hairline-strong px-4 py-2 text-sm font-medium text-tp-slate transition-colors hover:bg-tp-surface">
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-sm font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:opacity-50">
              {isSaving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
