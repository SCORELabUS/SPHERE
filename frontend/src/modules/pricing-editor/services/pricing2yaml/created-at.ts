/**
 * Pricing2Yaml's `createdAt` is a date (`yyyy-mm-dd`, read as UTC midnight) or an
 * ISO 8601 date-time with an explicit time zone (`Z` or `±hh:mm`).
 */
export const CREATED_AT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CREATED_AT_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export const isCreatedAtString = (value: string): boolean =>
  CREATED_AT_DATE_PATTERN.test(value) || CREATED_AT_DATETIME_PATTERN.test(value);

/** Writes an instant the way the spec stores it: a plain date at UTC midnight, the full UTC date-time otherwise. */
export function formatCreatedAt(createdAt: Date): string {
  const iso = createdAt.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}
