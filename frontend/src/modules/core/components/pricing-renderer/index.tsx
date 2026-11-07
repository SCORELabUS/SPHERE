import 'pricing-renderer/styles.css';

import { Box } from '@mui/material';
import {
  PricingRenderer,
  type PricingRendererProps,
  type PricingRendererStyle,
} from 'pricing-renderer/react';

import { SPHERE_PRICING_TOKENS } from './tokens';
import type { SpherePricingSource } from './source';

export type { SpherePricingSource } from './source';
export { pricingRendererSource, rendererCanParse, readSyntaxVersion } from './source';

/** Everything the package accepts except the source, which `source` carries instead. */
type RendererOverrides = Omit<
  PricingRendererProps,
  'pricing' | 'yaml' | 'src' | 'request' | 'loadPricing' | 'style'
>;

export interface SpherePricingRendererProps extends RendererOverrides {
  /** Exactly one of a YAML document or a parsed pricing. Build it with `pricingRendererSource`. */
  source: SpherePricingSource;
  /** Extra CSS custom properties or styles, merged over SPHERE's tokens. */
  style?: PricingRendererStyle;
}

/**
 * SPHERE's pricing view, drawn by `pricing-renderer`.
 *
 * The defaults below are the ones an authoring and research tool wants, which are not the ones a
 * customer-facing pricing page wants:
 *
 * - `diagnostics="verbose"` puts warnings on the page, not just in the `pricing-diagnostic` event.
 *   Everything SPHERE renders comes from a document someone is editing or studying, so a
 *   best-effort conversion or a type mismatch is the point, not noise. The renderer draws its own
 *   collapsed panel for them.
 * - `visibility="all"` shows plans and add-ons marked `private`. SPHERE catalogues pricings for
 *   study; hiding part of the model would misrepresent it.
 * - `mode="catalog"` adds the technical metadata that `"commercial"` leaves out.
 * - `ctaEnabled={false}` drops the per-plan call to action. SPHERE does not sell these
 *   subscriptions, so a "Choose Team" button would be a dead end. Selection stays on, so plans and
 *   add-ons can still be picked and priced.
 * - `theme="light"` because SPHERE's MUI palette is light-only (see `tokens.ts`). `"auto"` would
 *   turn the pricing area dark inside light chrome whenever the OS asks for dark.
 *
 * Any of them can be overridden per instance.
 */
const AUTHORING_DEFAULTS: RendererOverrides = {
  diagnostics: 'verbose',
  visibility: 'all',
  mode: 'catalog',
  ctaEnabled: false,
  theme: 'light',
  locale: 'en-US',
};

export function SpherePricingRenderer({ source, style, ...overrides }: SpherePricingRendererProps) {
  // `source` is already the package's own discriminated union, so this assembles a valid
  // PricingRendererProps; TypeScript cannot see that through a spread of a union, hence the single
  // assertion here rather than a branch that repeats every prop.
  //
  // A fresh object per render is deliberate: the element compares `yaml` and `src` by identity and
  // `pricing`, `request` and `normalizeOptions` by content, so nothing here starts a reload as long
  // as the caller holds its YAML string in state -- which both call sites do.
  const props = {
    ...source,
    ...AUTHORING_DEFAULTS,
    ...overrides,
    style: { ...SPHERE_PRICING_TOKENS, ...style },
  } as PricingRendererProps;

  return (
    // The renderer is a CSS container and sizes itself from its own inline width, so it must not be
    // given a fixed width. `minWidth: 0` keeps it from forcing a flex or grid parent wider than the
    // track, which is what its docs ask of an embedding host.
    <Box sx={{ width: '100%', minWidth: 0 }}>
      <PricingRenderer {...props} />
    </Box>
  );
}

export default SpherePricingRenderer;
