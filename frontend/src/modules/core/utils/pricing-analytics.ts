/**
 * Whether a pricing version has analytics to show. A version can lack them, or
 * have them empty ({}), when computing them failed: it is still a usable pricing.
 */
export function hasAnalytics<T extends object>(analytics: T | null | undefined): analytics is T {
  return (
    !!analytics &&
    Object.values(analytics).some(value => typeof value === 'number' && Number.isFinite(value))
  );
}
