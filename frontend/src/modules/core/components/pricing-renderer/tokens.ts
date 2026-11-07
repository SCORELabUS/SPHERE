import type { PricingRendererStyle } from 'pricing-renderer/react';

/**
 * SPHERE's design language expressed as `pricing-renderer`'s public CSS custom properties.
 *
 * Every value points at a token from `src/styles/tailwind.css` rather than repeating a hex code, so
 * the renderer follows the palette wherever it is retuned, and picks up the dark values for free on
 * the day the `.dark` block there is uncommented.
 *
 * Theming goes through tokens on purpose. The package's own rules live in `@layer pricing-renderer`
 * and `@layer pricing-renderer.theme`, and an unlayered selector written here would outrank all of
 * them -- it would work today and break on the next release of the package.
 *
 * On the accent: `--color-tp-primary` (#fa520f) against white is about 3.35:1. That clears WCAG AA
 * for large text and for UI components, but not the 4.5:1 for small text on an accent fill. It is
 * the pair SPHERE already ships on its own primary buttons (`--color-tp-on-primary` is white), so
 * the renderer matching it is the consistent choice; `--color-tp-primary-deep` (#cc3a05, 5.0:1)
 * is the drop-in if that threshold ever has to be met inside the pricing area.
 */
export const SPHERE_PRICING_TOKENS: PricingRendererStyle = {
  // Brand
  '--pr-color-accent': 'var(--color-tp-primary)',
  '--pr-color-on-accent': 'var(--color-tp-on-primary)',
  '--pr-color-link': 'var(--color-tp-link)',
  '--pr-color-focus': 'var(--color-tp-primary)',

  // Surfaces
  '--pr-color-surface': 'var(--color-tp-canvas)',
  '--pr-color-surface-raised': 'var(--color-tp-canvas)',
  '--pr-color-surface-subtle': 'var(--color-tp-surface)',

  // Text
  '--pr-color-text': 'var(--color-tp-ink)',
  '--pr-color-muted': 'var(--color-tp-steel)',

  // Lines
  '--pr-color-border': 'var(--color-tp-hairline-soft)',
  '--pr-color-border-strong': 'var(--color-tp-hairline)',

  // Status
  '--pr-color-success': 'var(--color-tp-severity-success)',
  '--pr-color-warning': 'var(--color-tp-severity-warning)',
  '--pr-color-warning-surface': 'var(--color-tp-severity-warning-bg)',

  // Shape. DESIGN.md: 8px for buttons and inputs, 12px for cards and panels, and no pills.
  '--pr-radius-sm': 'var(--radius-sm)',
  '--pr-radius-md': 'var(--radius-md)',
  '--pr-radius-lg': 'var(--radius-lg)',

  // Type. The body face is Inter and the display face is the editorial serif the rest of the site
  // uses for headings, which is what `--pr-font-family-display` is for.
  '--pr-font-family': 'var(--font-body)',
  '--pr-font-family-display': 'var(--font-display)',
};
