/**
 * The version a pricing page opens with: the one named by `?version=` when the
 * page lists it, matched first by id (any letter case, as ids are hexadecimal)
 * and then by exact name, and otherwise the first (newest) one. The page only
 * lists the versions the viewer may see, so a hidden or unknown version falls
 * back to the default without saying why.
 */
export function pickRequestedVersion<T extends { id: string; version: string }>(
  versions: T[],
  requested: string | null
): T | null {
  if (requested) {
    const id = requested.toLowerCase();
    const match =
      versions.find(version => version.id.toLowerCase() === id) ??
      versions.find(version => version.version === requested);
    if (match) return match;
  }
  return versions[0] ?? null;
}
