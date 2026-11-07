import type { PricingRendererStyle } from 'pricing-renderer/react';

import { common, grey, primary, success, warning } from '../../theme/palette';

/**
 * SPHERE's look expressed as `pricing-renderer`'s public CSS custom properties.
 *
 * The renderer is themed through tokens rather than by overriding its CSS: its own rules live in
 * `@layer pricing-renderer` and `@layer pricing-renderer.theme`, so any unlayered selector we wrote
 * here would outrank every one of them and break as soon as the package changes its markup.
 *
 * SPHERE's MUI palette (`core/theme/palette.ts`) is light-only -- `palette()` hardcodes
 * `mode: 'light'` -- so these values are static and the renderer is pinned to `theme="light"`.
 * If SPHERE ever gains a real dark palette, this map becomes a function of the mode and the
 * renderer's `theme` prop should follow `useMode()`.
 *
 * `--pr-color-accent` is `primary[700]` rather than MUI's derived `primary.main` (`primary[500]`,
 * `#00b4d8`): the accent carries white text in the renderer's CTAs and selected states, and
 * `#00b4d8` on white is about 2.5:1. `#0077b6` on white is about 4.9:1, so it passes WCAG AA while
 * staying SPHERE's own brand blue.
 */
export const SPHERE_PRICING_TOKENS: PricingRendererStyle = {
  // Colour
  '--pr-color-accent': primary[700],
  '--pr-color-on-accent': common.white,
  '--pr-color-surface': '#FFFFFF',
  '--pr-color-surface-raised': '#FFFFFF',
  '--pr-color-surface-subtle': grey[200],
  '--pr-color-text': grey[800],
  '--pr-color-muted': grey[600],
  '--pr-color-link': primary[800],
  '--pr-color-focus': primary[600],
  '--pr-color-success': success.main,
  '--pr-color-warning': warning.dark,
  '--pr-color-warning-surface': warning.lighter,
  '--pr-color-border': grey[300],
  '--pr-color-border-strong': grey[400],

  // Shape. MUI's default radius is 4px; SPHERE leaves `shape` at the default
  // (see the commented-out `shape` in core/theme/theme.tsx) and its Paper/Card
  // surfaces read as lightly rounded, so keep the renderer in the same register
  // instead of the package's much rounder defaults.
  '--pr-radius-sm': '4px',
  '--pr-radius-md': '6px',
  '--pr-radius-lg': '8px',

  // Type. `--pr-font-family` defaults to `unset`, which already inherits Roboto
  // from MUI's CssBaseline, so it is deliberately not set here.
  '--pr-line-height': '1.5',
};
