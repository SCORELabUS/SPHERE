import { useState } from 'react';
import { usePricingContext } from '../hooks/usePricingContext';
import { usePricingVersions } from '../hooks/useVersion';
import { fetchPricingYaml } from '../sphere';
import { SphereContextItemInput } from '../types/types';
import PricingVersionLoader from './PricingVersionLoader';

interface PricingVersionProps {
  organizationId: string;
  owner: string;
  slug: string;
  collectionSlug?: string | null;
  onContextAdd: (input: SphereContextItemInput) => void;
  onContextRemove: (id: string) => void;
}

function PricingVersions({
  organizationId,
  owner,
  slug,
  collectionSlug,
  onContextAdd,
  onContextRemove,
}: PricingVersionProps) {
  const { loading, error, versions } = usePricingVersions(organizationId, slug, collectionSlug);
  const pricingContextItems = usePricingContext();
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isVersionIncludedInContext = (yamlPath: string) =>
    pricingContextItems.some(
      item => item.origin && item.origin === 'sphere' && item.yamlPath === yamlPath
    );

  const versionItems = versions?.versions ?? [];
  const totalVersions = versionItems.length;
  const selectedVersion =
    versionItems.find(item => item.id === selectedVersionId) ?? versionItems[0];

  if (error) {
    return <p className="text-xs text-red-500">Failed to load versions.</p>;
  }

  if (loading) {
    return <PricingVersionLoader />;
  }

  const calculateLabel = (name: string, collectionSlug?: string | null) =>
    `${collectionSlug ? collectionSlug + '/' : ''}${name}`;

  const versionLabel = totalVersions === 1 ? 'version' : 'versions';

  const handleAddSpherePricing = async () => {
    if (!selectedVersion) return;

    try {
      setIsAdding(true);
      setActionError(null);
      const yamlFile = await fetchPricingYaml(selectedVersion.yaml);
      onContextAdd({
        sphereId: selectedVersion.id,
        kind: 'yaml',
        label: calculateLabel(slug, collectionSlug),
        value: yamlFile,
        origin: 'sphere',
        owner: owner,
        yamlPath: selectedVersion.yaml,
        pricingName: slug,
        version: selectedVersion.version,
        collection: collectionSlug ?? null,
      });
    } catch {
      setActionError('Failed to add this version.');
    } finally {
      setIsAdding(false);
    }
  };

  if (!selectedVersion) {
    return <p className="text-xs text-tp-muted">No versions available.</p>;
  }

  const isSelectedVersionIncluded = isVersionIncludedInContext(selectedVersion.yaml);

  return (
    <div className="mt-2">
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-tp-muted">
            Version <span className="normal-case tracking-normal">· {totalVersions} {versionLabel}</span>
          </span>
          <span className="relative block">
            <select
              value={selectedVersion.id}
              onChange={event => {
                setSelectedVersionId(event.target.value);
                setActionError(null);
              }}
              className="h-8 w-full cursor-pointer appearance-none rounded-lg border border-tp-hairline-strong bg-tp-canvas px-2.5 pr-8 text-xs font-medium text-tp-ink outline-none transition-colors hover:border-tp-primary/40 focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
            >
              {versionItems.map(item => (
                <option key={item.id} value={item.id}>
                  {item.version}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tp-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 9.75 3.75 3.75 3.75-3.75" />
            </svg>
          </span>
        </label>

        {isSelectedVersionIncluded ? (
          <button
            type="button"
            className="h-8 shrink-0 cursor-pointer rounded-lg border border-red-300 bg-red-50 px-3 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-500 hover:text-white"
            onClick={() => onContextRemove(selectedVersion.id)}
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            disabled={isAdding}
            className="h-8 shrink-0 cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 text-[11px] font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleAddSpherePricing}
          >
            {isAdding ? 'Adding…' : 'Add'}
          </button>
        )}
      </div>
      {actionError && <p className="mt-1.5 text-[11px] text-red-500">{actionError}</p>}
    </div>
  );
}

export default PricingVersions;
