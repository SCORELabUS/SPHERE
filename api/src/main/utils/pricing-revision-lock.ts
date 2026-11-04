/**
 * Pricing metadata and its revision live in separate MongoDB documents. Keep
 * revision-bearing reads outside the complete claim/write/response snapshot,
 * including writes made without If-Match (for example through ORBIT).
 *
 * Shared across service instances in this API process. The current deployment
 * runs one API process; multiple API processes would need shared coordination
 * or MongoDB transactions, not an independent queue in each process.
 */
const tails = new Map<string, Promise<void>>();

export async function withPricingRevisionLock<T>(pricingId: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(pricingId) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => turn);
  tails.set(pricingId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (tails.get(pricingId) === tail) tails.delete(pricingId);
  }
}

/** Stable ordering also handles slugs shared by distinct collection identities. */
export function withPricingRevisionLocks<T>(pricingIds: string[], operation: () => Promise<T>): Promise<T> {
  const ids = [...new Set(pricingIds)].sort();
  const acquire = (index: number): Promise<T> => index === ids.length
    ? operation()
    : withPricingRevisionLock(ids[index], () => acquire(index + 1));
  return acquire(0);
}
