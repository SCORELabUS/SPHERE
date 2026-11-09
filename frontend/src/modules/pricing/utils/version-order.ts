/** An instant sent by the API, or -Infinity when it is missing or unreadable (it sorts first). */
export function versionInstant(value: string | null | undefined): number {
  const time = Date.parse(value ?? '');
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

const compare = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

type Orderable = { id: string; createdAt?: string | null; addedAt?: string | null };

/**
 * Release order, oldest first: the reverse of the API's `VERSION_ORDER`. By `createdAt`
 * (the YAML's date, a day or a date-time, compared as instants), then by when SPHERE
 * received the version (`addedAt`), then by id.
 */
export function compareVersionsOldestFirst(a: Orderable, b: Orderable): number {
  return (
    compare(versionInstant(a.createdAt), versionInstant(b.createdAt)) ||
    compare(versionInstant(a.addedAt), versionInstant(b.addedAt)) ||
    a.id.localeCompare(b.id)
  );
}
