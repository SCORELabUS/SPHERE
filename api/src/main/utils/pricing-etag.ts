/**
 * Entity tags for optimistic concurrency on pricings.
 *
 * A pricing's tag names its permanent id (the PricingIdentity shared by all its
 * versions) and its revision, a counter on that identity that moves on with
 * every write to any of its versions: `"<pricingId>.<revision>"`. The id keeps a
 * tag from matching another pricing that later takes the same slug.
 */

export type PricingPrecondition =
  | { kind: 'any' }
  | { kind: 'tags'; tags: Array<{ pricingId: string; revision: number }> };

/**
 * Passed by the controller to a read or a write: the write's `If-Match`, if any,
 * and where the service leaves the pricing's ETag after reading or writing it.
 */
export interface PricingRevisionContext {
  precondition?: PricingPrecondition;
  /** Set by the service when the pricing (still) exists and the caller may read its revision. */
  etag?: string;
  /** Whether the caller may read the revision (may read private versions); set by the service. */
  mayRead?: boolean;
}

const TAG = /^(?:W\/)?"([0-9a-f]{24})\.(\d{1,15})"$/;

export function formatPricingEtag(pricingId: string, revision: number): string {
  return `"${pricingId}.${revision}"`;
}

/**
 * Parses an `If-Match` header. Returns undefined when there is none. Tags that
 * are not ours are dropped, so a header made only of them never matches (412).
 * A `W/` prefix is accepted because a compressing proxy turns strong tags weak
 * on the way out; the tag still names the same revision.
 */
export function parseIfMatch(header: unknown): PricingPrecondition | undefined {
  if (header === undefined || header === null) return undefined;
  const value = Array.isArray(header) ? header.join(',') : String(header);
  if (value.trim() === '') return undefined;
  if (value.trim() === '*') return { kind: 'any' };

  const tags = value
    .split(',')
    .map(part => TAG.exec(part.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({ pricingId: match[1], revision: Number(match[2]) }));
  return { kind: 'tags', tags };
}

/** Whether writes that change an existing pricing must carry If-Match (opt-in, off by default). */
export function isIfMatchRequired(): boolean {
  return process.env.PRICING_REQUIRE_IF_MATCH === 'true';
}

/** A failed If-Match (412). Carries the pricing's current ETag when it still exists. */
export class PreconditionFailedError extends Error {
  constructor(public readonly currentEtag?: string) {
    super(
      'PRECONDITION FAILED: The pricing has changed since you read it. Reload it and try again.'
    );
    this.name = 'PreconditionFailedError';
  }
}
