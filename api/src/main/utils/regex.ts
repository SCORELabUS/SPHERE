/**
 * Escapes special regex characters in a string so it can be safely
 * used in a `new RegExp()` or MongoDB `$regex` pattern.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
