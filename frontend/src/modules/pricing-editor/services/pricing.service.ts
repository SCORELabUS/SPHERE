/**
 * Turns a Pricing2Yaml identifier into something readable, e.g. `extraStorage` -> `Extra Storage`.
 *
 * `pricing-renderer` applies the same rule internally (`humanizeIdentifier`) to everything it
 * draws, so this is only needed where SPHERE renders model identifiers itself -- today the
 * configuration-space cards and their details modal.
 */
export function formatPricingComponentName(name: string) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, str => str.toUpperCase());
}

/** `request/month` -> `requests/month`, `seat` -> `seats`. Used by the visual editor's helpers. */
export function pluralizeUnit(unit: string) {
  if (unit.includes('/')) {
    const [first, second] = unit.split('/');
    return `${first}s/${second}`;
  } else {
    return `${unit}s`;
  }
}
