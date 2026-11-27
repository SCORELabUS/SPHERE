/**
 * Where the browser can read a version's YAML. The API stamps absolute URLs
 * with its own `SERVER_HOST`, which the browser cannot always reach (local
 * development). Everything under `/static` and `/api/v1` (where versions of a
 * private collection link their YAML) is served from this page's origin in
 * every environment, so only the path is kept.
 */
export function versionYamlUrl(yaml: string): string {
  // Read on each call, not when the module loads: importing this module must
  // not fail where VITE_API_URL is not set (e.g. tests of pages that use it).
  const apiUrl: string = import.meta.env.VITE_API_URL ?? '';
  if (!yaml.startsWith('http')) return `${apiUrl}${yaml}`;
  try {
    const { pathname } = new URL(yaml);
    return pathname.startsWith('/static/') || pathname.startsWith('/api/v1/')
      ? `${apiUrl.replace('/api/v1', '')}${pathname}`
      : yaml;
  } catch {
    return yaml;
  }
}
