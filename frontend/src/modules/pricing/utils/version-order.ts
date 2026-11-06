/** Insertion order in SPHERE; createdAt is only a fallback for older API responses. */
export function versionAddedTime(version: { addedAt?: string | null; createdAt?: string | null }): number {
  const time = Date.parse(version.addedAt ?? version.createdAt ?? '');
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export function compareVersionsOldestFirst(
  a: { id: string; addedAt?: string | null; createdAt?: string | null },
  b: { id: string; addedAt?: string | null; createdAt?: string | null }
): number {
  const first = versionAddedTime(a);
  const second = versionAddedTime(b);
  return (first === second ? 0 : first < second ? -1 : 1) || a.id.localeCompare(b.id);
}
