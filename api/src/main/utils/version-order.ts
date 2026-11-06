/**
 * The order of a pricing's versions, newest first. `createdAt` comes from the
 * YAML and can tie (two versions dated the same day, or the same second), so
 * ties go to the version added to SPHERE later (`addedAt`, set by the server),
 * and then to the later `_id`, which also orders versions added together.
 */
export const VERSION_ORDER = { createdAt: -1, addedAt: -1, _id: -1 } as const;

/** The same order for versions already turned into `{ id, createdAt, addedAt }`. */
export const VERSION_ITEM_ORDER = { createdAt: -1, addedAt: -1, id: -1 } as const;

const time = (value: unknown) => {
  if (value === undefined || value === null) return Number.NEGATIVE_INFINITY;
  const ms = new Date(value as string | Date).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

const diff = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

type Orderable = { createdAt?: unknown; addedAt?: unknown; _id?: unknown; id?: unknown };

/** Sorts versions newest first, as `VERSION_ORDER` does in MongoDB. */
export function compareVersionsNewestFirst(a: Orderable, b: Orderable): number {
  return (
    diff(time(b.createdAt), time(a.createdAt)) ||
    diff(time(b.addedAt), time(a.addedAt)) ||
    String(b._id ?? b.id ?? '').localeCompare(String(a._id ?? a.id ?? ''))
  );
}
