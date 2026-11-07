import type { Pricing } from 'pricing4ts';

/**
 * The input `pricing-renderer` takes: exactly one of a YAML document or an already-parsed pricing.
 * The package's own props are a discriminated union, so the two can never both be set.
 */
export type SpherePricingSource =
  | { yaml: string; pricing?: never }
  | { pricing: Pricing; yaml?: never };

/** Top-level `syntaxVersion` of a Pricing2Yaml document, e.g. `'2.1'`. */
export function readSyntaxVersion(yaml: string): string | undefined {
  // Top-level keys sit at column 0, so anchoring there avoids matching a nested or quoted
  // occurrence further down the document.
  return /^syntaxVersion\s*:\s*['"]?([0-9]+(?:\.[0-9]+)?)/m.exec(yaml)?.[1];
}

/**
 * Whether `pricing-renderer` can parse this document itself.
 *
 * The package normalizes Pricing2Yaml 3.1 fully and any other 3.x as a best-effort subset. A major
 * below 3 is a blocking `PR_VERSION_UNSUPPORTED_MAJOR` error, and 159 of the 168 pricings seeded in
 * this repository are still `syntaxVersion: '2.1'`, so that is the common case, not an edge one.
 */
export function rendererCanParse(yaml: string): boolean {
  const version = readSyntaxVersion(yaml);
  return version !== undefined && version.split('.')[0] === '3';
}

/**
 * Picks what to hand the renderer for one pricing version.
 *
 * Prefer the YAML: it is the document the author wrote, so the renderer keeps its `syntaxVersion`,
 * its labels and any `custom.pricingRenderer` presentation block. That only works for 3.x. For an
 * older document SPHERE has no 3.x source to give, so it falls back to the pricing object that
 * `PUT /api/v1/pricings` returns -- pricing4ts upgrades 1.0 -> 1.1 -> 2.0 -> 2.1 -> 3.0 -> 3.1 on
 * the server. Both inputs normalize to the same view model with no diagnostics; the upgrade itself
 * is the only place fidelity can be lost, and it happens either way.
 *
 * Returns `undefined` while neither input is available yet.
 */
export function pricingRendererSource(
  yaml: string | null | undefined,
  upgraded: Pricing | null | undefined
): SpherePricingSource | undefined {
  if (yaml && rendererCanParse(yaml)) return { yaml };
  if (upgraded) return { pricing: upgraded };
  return undefined;
}
