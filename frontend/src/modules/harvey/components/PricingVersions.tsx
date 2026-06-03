import { usePricingContext } from '../hooks/usePricingContext';
import { usePricingVersions } from '../hooks/useVersion';
import { fetchPricingYaml } from '../sphere';
import { SphereContextItemInput } from '../types/types';
import PricingVersionLoader from './PricingVersionLoader';

interface PricingVersionProps {
  owner: string;
  slug: string;
  collectionSlug?: string | null;
  onContextAdd: (input: SphereContextItemInput) => void;
  onContextRemove: (id: string) => void;
}

function PricingVersions({
  owner,
  slug,
  collectionSlug,
  onContextAdd,
  onContextRemove,
}: PricingVersionProps) {
  const { loading, error, versions } = usePricingVersions(owner, slug, collectionSlug);
  const pricingContextItems = usePricingContext();

  const isVersionIncludedInContext = (yamlPath: string) =>
    pricingContextItems.filter(
      item => item.origin && item.origin === 'sphere' && item.yamlPath === yamlPath
    ).length > 0;

  const totalVersions = versions?.versions.length;

  if (error) {
    return <p className="text-xs text-red-500">Failed to load versions.</p>;
  }

  if (loading) {
    return <PricingVersionLoader />;
  }

  const calculateLabel = (name: string, collectionSlug?: string | null) =>
    `${collectionSlug ? collectionSlug + '/' : ''}${name}`;

  const versionLabel = totalVersions === 1 ? 'version' : 'versions';

  const handleAddSpherePricing = async (sphereId: string, yamlUrl: string, version: string) => {
    const yamlFile = await fetchPricingYaml(yamlUrl);
    onContextAdd({
      sphereId: sphereId,
      kind: 'yaml',
      label: calculateLabel(name, collectionSlug),
      value: yamlFile,
      origin: 'sphere',
      owner: owner,
      yamlPath: yamlUrl,
      pricingName: name,
      version: version,
      collection: collectionSlug ?? null,
    });
  };

  return (
    <>
      {totalVersions && (
        <span className="inline-flex rounded-full bg-tp-surface px-2.5 py-0.5 text-[11px] text-tp-steel">
          {totalVersions} {versionLabel}
        </span>
      )}
      <ul className="mt-2 space-y-1.5">
        {versions?.versions.map(item => (
          <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-tp-hairline-soft px-3 py-2">
            <span className="truncate text-xs text-tp-ink">{item.version}</span>
            {!isVersionIncludedInContext(item.yaml) ? (
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1 text-[11px] font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                onClick={() => handleAddSpherePricing(item.id, item.yaml, item.version)}
              >
                Add
              </button>
            ) : (
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-500 hover:text-white"
                onClick={() => onContextRemove(item.id)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export default PricingVersions;
