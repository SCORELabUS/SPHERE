/**
 * A boolean sent as JSON (`true`) or as a form field (`'true'`). Any other
 * value is `undefined`, so a caller can refuse it rather than guess.
 */
export function parseBooleanField(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}
