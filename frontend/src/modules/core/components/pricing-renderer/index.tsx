import { forwardRef } from 'react';
import {
  PricingRenderer,
  type PricingRendererElement,
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

/**
 * SPHERE shows pricings in two quite different situations, and they want opposite defaults.
 *
 * - `catalog` is the pricing card and the Pricing2Yaml editor: a document someone is studying or
 *   writing. Diagnostics belong on the page, private plans must be visible or the model is
 *   misrepresented, the technical metadata is the point, and there is nothing to buy.
 * - `commercial` is SPHERE's own pricing page at `/pricing`: a real storefront, where a warning
 *   about a `.inf` usage limit is the reader's problem to not have.
 */
export type SpherePricingPreset = 'catalog' | 'commercial';

const PRESETS: Record<SpherePricingPreset, RendererOverrides> = {
  catalog: {
    diagnostics: 'verbose',
    visibility: 'all',
    mode: 'catalog',
    ctaEnabled: false,
  },
  commercial: {
    diagnostics: 'auto',
    visibility: 'public-only',
    mode: 'commercial',
    ctaEnabled: true,
  },
};

export interface SpherePricingRendererProps extends RendererOverrides {
  /** Exactly one of a YAML document or a parsed pricing. Build it with `pricingRendererSource`. */
  source: SpherePricingSource;
  /** Which situation this is. Defaults to `catalog`. */
  preset?: SpherePricingPreset;
  /** Extra CSS custom properties or styles, merged over SPHERE's tokens. */
  style?: PricingRendererStyle;
  /** Wrapper class, for layout only. */
  className?: string;
}

/**
 * SPHERE's pricing view, drawn by `pricing-renderer`.
 *
 * `theme` is pinned to `"light"`, not `"auto"`. SPHERE does toggle a `.dark` class on the root
 * element (`core/theme/theme.tsx`) and the package would follow that ancestor under `"auto"` -- but
 * the `.dark` token block in `src/styles/tailwind.css` is commented out (lines 161-229) and none of
 * the pricing-display components carry `dark:` utilities, so the pricing area is light whatever the
 * toggle says. Under `"auto"` the renderer alone would go dark inside a light page. Uncomment that
 * block and this becomes a one-word change.
 */
export const SpherePricingRenderer = forwardRef<PricingRendererElement, SpherePricingRendererProps>(
  function SpherePricingRenderer(
    { source, preset = 'catalog', style, className, ...overrides },
    ref
  ) {
    // `source` is already the package's own discriminated union, so this assembles a valid
    // PricingRendererProps; TypeScript cannot see that through a spread of a union, hence the single
    // assertion here rather than a branch that repeats every prop.
    //
    // A fresh object per render is deliberate: the element compares `yaml` and `src` by identity and
    // `pricing`, `request` and `normalizeOptions` by content, so nothing here starts a reload as long
    // as the caller holds its YAML string in state -- which every call site does.
    const props = {
      ...source,
      ...PRESETS[preset],
      theme: 'light',
      locale: 'en-US',
      ...overrides,
      style: { ...SPHERE_PRICING_TOKENS, ...style },
    } as PricingRendererProps;

    // The renderer is a CSS container and sizes itself from its own inline width, so it must not be
    // given a fixed width. `min-w-0` keeps it from forcing a flex or grid parent wider than the
    // track, which is what its docs ask of an embedding host.
    return (
      <div className={`w-full min-w-0 ${className ?? ''}`}>
        <PricingRenderer ref={ref} {...props} />
      </div>
    );
  }
);

export default SpherePricingRenderer;
