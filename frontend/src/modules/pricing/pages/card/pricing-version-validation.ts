export function pricingVersionNameMatches(uploadedName: string | undefined, currentName: string | undefined): boolean {
  return Boolean(uploadedName && currentName && uploadedName === currentName);
}
