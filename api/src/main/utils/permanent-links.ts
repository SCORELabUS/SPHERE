/**
 * Relative path of the public route that serves the YAML of a public version
 * (`GET /public/pricings/{pricingId}/versions/{versionId}/yaml`). `processFileUris`
 * turns it into an absolute URL as it does for files under `/static`. Unlike the
 * stored file path, it says nothing about the collection the pricing is in.
 */
export function permanentYamlPath(pricingId: string, versionId: string): string {
  const base = `${process.env.BASE_URL_PATH ?? ''}/api/v1`.replace(/^\/+/, '');
  return `${base}/public/pricings/${encodeURIComponent(pricingId)}/versions/${encodeURIComponent(versionId)}/yaml`;
}
