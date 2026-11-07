/**
 * Turns a Pricing2Yaml identifier into something readable, e.g. `extraStorage` -> `Extra Storage`.
 *
 * `pricing-renderer` applies the same rule internally (`humanizeIdentifier`) for anything it draws,
 * so this is only needed where SPHERE renders model identifiers itself -- today the
 * configuration-space cards and their details modal.
 */
export function formatPricingComponentName(name: string) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, str => str.toUpperCase());
}
