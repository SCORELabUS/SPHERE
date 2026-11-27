type OrderableVersion = { id: string; createdAt?: string | null; addedAt?: string | null };

function compareDates(a?: string | null, b?: string | null): number {
  const first = a ? Date.parse(a) : NaN;
  const second = b ? Date.parse(b) : NaN;
  if (Number.isNaN(first)) return Number.isNaN(second) ? 0 : -1;
  if (Number.isNaN(second)) return 1;
  return first - second;
}

export function compareVersionUploads(a: OrderableVersion, b: OrderableVersion): number {
  return compareDates(a.addedAt, b.addedAt) || a.id.localeCompare(b.id);
}

export function compareVersionsOldestFirst(a: OrderableVersion, b: OrderableVersion): number {
  return compareDates(a.createdAt, b.createdAt) || compareVersionUploads(a, b);
}
