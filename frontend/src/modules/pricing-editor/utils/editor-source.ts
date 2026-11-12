/** Where a published pricing lives, as the editor's `?source=` names it. */
export interface EditorPricingLocation {
  organizationId: string;
  slug: string;
  collectionSlug?: string | null;
}

/**
 * The editor opened on a version of a published pricing: `?source=` names the
 * pricing, `versionId` the version (its label stays for older links and for
 * display) and `pr` an open pull request whose proposal is edited again.
 */
export function editorPath(
  pricing: EditorPricingLocation,
  version: { id: string; version: string },
  options: { mode?: 'code' | 'visual'; pullRequestId?: string } = {}
): string {
  const params = new URLSearchParams({
    source: `${pricing.organizationId}/${pricing.slug}`,
    version: version.version,
    versionId: version.id,
    mode: options.mode ?? 'code',
  });
  if (pricing.collectionSlug) params.set('collection', pricing.collectionSlug);
  if (options.pullRequestId) params.set('pr', options.pullRequestId);
  return `/editor?${params.toString()}`;
}

/**
 * The version the editor opens: the one named by id, else the one with the
 * label, else the newest it can read (so Publish still has a base). Only a
 * version found by its id is known to be the one the link meant: a label can
 * belong to a version deleted and created again.
 */
export function pickSourceVersion<T extends { id: string; version: string }>(
  versions: readonly T[],
  requested: { versionId?: string | null; version?: string | null }
): { version: T | undefined; byId: boolean } {
  const byId = requested.versionId ? versions.find(item => item.id === requested.versionId) : undefined;
  if (byId) return { version: byId, byId: true };
  return { version: versions.find(item => item.version === requested.version) ?? versions[0], byId: false };
}
