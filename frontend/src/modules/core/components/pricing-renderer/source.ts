import { retrievePricingFromYaml, type Pricing } from 'pricing4ts';

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

/** The Pricing2Yaml syntax `pricing-renderer` normalizes in full, and the one the API upgrades to. */
export const LATEST_SYNTAX_VERSION = '3.1';

/**
 * Where a document older than `LATEST_SYNTAX_VERSION` is upgraded. `PUT /pricings` parses the
 * document it is handed and answers with the pricing object, walking pricing4ts' upgrade chain
 * 1.0 -> 1.1 -> 2.0 -> 2.1 -> 3.0 -> 3.1. It stores nothing and needs no credentials: the document
 * travels in the body.
 */
const PRICING_UPGRADE_ENDPOINT = '/api/v1/pricings';

/**
 * Reads one Pricing2Yaml document and answers with a pricing the renderer can draw.
 *
 * Parsing in the browser is only safe for a document that already is 3.1. `retrievePricingFromYaml`
 * accepts an older one without complaining, but hands back an object that still declares the
 * original `syntaxVersion`, so a 2.1 pricing reaches `pricing-renderer` as a major 2 and is refused
 * with `PR_VERSION_UNSUPPORTED_MAJOR`. Because that parse does not throw, a `try`/`catch` around it
 * never reaches the upgrade: the version has to be read first, which is what this does.
 *
 * Throws when the document can be neither parsed nor upgraded, leaving the message to the caller.
 */
export async function retrieveUpgradedPricing(yaml: string, signal?: AbortSignal): Promise<Pricing> {
  // Folded on both paths: the renderer takes a 3.1 document as YAML, but the object parsed from it
  // still reaches the renderer for as long as the editor's text is older than the object it holds
  // (the editor updates its value inside the same debounce that asks for the upgrade), and an
  // unfolded entry prints its JSON there.
  if (readSyntaxVersion(yaml) === LATEST_SYNTAX_VERSION) {
    return withEffectiveValues(retrievePricingFromYaml(yaml));
  }

  const response = await fetch(PRICING_UPGRADE_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pricing: yaml }),
    signal,
  });

  if (!response.ok) {
    throw new Error('Failed to parse pricing. Please check the YAML syntax.');
  }

  return withEffectiveValues((await response.json()) as Pricing);
}

/**
 * Folds each plan's features and usage limits to the value that plan actually gives.
 *
 * The upgraded object describes them as the whole feature or limit, carrying a `value` only where
 * the plan overrides the default. `pricing-renderer` reads such an entry as the value itself, so a
 * card holding a non-boolean feature prints the entry's JSON where its value belongs -- 43 of the
 * 159 pricings below 3.1 seeded in this repository have at least one. Folding also restores the
 * per-plan overrides: Databox's "Data Refresh" reads `daily` on FREE and `hourly` on BASIC, where
 * both printed the same JSON before.
 *
 * A 3.x document never comes through here, since the renderer is handed its YAML untouched.
 */
function withEffectiveValues(pricing: Pricing): Pricing {
  const fold = (entries: unknown): unknown => {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return entries;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const e = entry as Record<string, unknown>;
        out[key] = { value: 'value' in e ? e.value : e.defaultValue };
      } else {
        out[key] = entry;
      }
    }
    return out;
  };

  const foldOwner = (owner: unknown) => {
    if (!owner || typeof owner !== 'object') return;
    const o = owner as Record<string, unknown>;
    if (o.features) o.features = fold(o.features);
    if (o.usageLimits) o.usageLimits = fold(o.usageLimits);
  };

  Object.values((pricing as unknown as { plans?: Record<string, unknown> }).plans ?? {}).forEach(foldOwner);
  Object.values((pricing as unknown as { addOns?: Record<string, unknown> }).addOns ?? {}).forEach(foldOwner);
  return pricing;
}
