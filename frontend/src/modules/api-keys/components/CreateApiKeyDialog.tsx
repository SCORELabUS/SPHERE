import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ApiKeyScope, CreateApiKeyData } from '../api/apiKeysApi';
import OrganizationSearchInput, { OrgSearchResult } from './OrganizationSearchInput';
import ScopeSelector from './ScopeSelector';
import BlockAlert from '../../core/components/block-alert';

interface CreateApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateApiKeyData) => Promise<void>;
}

export default function CreateApiKeyDialog({
  open,
  onClose,
  onCreate,
}: CreateApiKeyDialogProps) {
  const [name, setName] = useState('');
  const [selectedOrgs, setSelectedOrgs] = useState<OrgSearchResult[]>([]);
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), scopes });
      setName('');
      setSelectedOrgs([]);
      setScopes([]);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create API key');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-[90%] max-w-2xl rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="mb-4 text-lg font-semibold text-tp-ink">
            Create new API key
          </h2>

          <BlockAlert variant="warning" className="mb-4">
            This key will only be shown once. Make sure to copy it now.
            You won't be able to see it again.
          </BlockAlert>

          {error && (
            <BlockAlert variant="error" className="mb-4">
              {error}
            </BlockAlert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-tp-ink">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., CI/CD Pipeline"
                className="w-full rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2 text-sm text-tp-ink placeholder:text-tp-steel focus:border-tp-primary focus:outline-none focus:ring-1 focus:ring-tp-primary"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-tp-ink">
                Organizations
              </label>
              <OrganizationSearchInput
                selectedOrgs={selectedOrgs}
                onOrgsChange={(orgs) => {
                  setSelectedOrgs(orgs);
                  const orgIds = orgs.map((o) => o.id);
                  const existingScopes = scopes.filter((s) =>
                    orgIds.includes(s.organizationId)
                  );
                  const newOrgs = orgs.filter(
                    (o) => !scopes.some((s) => s.organizationId === o.id)
                  );
                  const newScopes = newOrgs.map((o) => ({
                    organizationId: o.id,
                    scope: 'VIEW' as const,
                  }));
                  setScopes([...existingScopes, ...newScopes]);
                }}
              />
            </div>

            <ScopeSelector
              organizations={selectedOrgs}
              selectedScopes={scopes}
              onChange={setScopes}
            />

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-tp-hairline px-4 py-2 text-sm text-tp-slate transition-colors hover:bg-tp-surface"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !name.trim() || scopes.length === 0}
                className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-sm font-medium text-tp-on-primary transition-colors hover:bg-tp-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create key'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
