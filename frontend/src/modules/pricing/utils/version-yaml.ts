const API_BASE = import.meta.env.VITE_API_URL.replace('/api/v1', '');

/**
 * Where the browser can read a version's YAML. The API stamps absolute URLs
 * with its own `SERVER_HOST`, which the browser cannot always reach (local
 * development). Everything under `/static` and `/api/v1` (where versions of a
 * private collection link their YAML) is served from this page's origin in
 * every environment, so only the path is kept.
 */
export function versionYamlUrl(yaml: string): string {
  if (!yaml.startsWith('http')) return `${import.meta.env.VITE_API_URL}${yaml}`;
  try {
    const { pathname } = new URL(yaml);
    return pathname.startsWith('/static/') || pathname.startsWith('/api/v1/')
      ? `${API_BASE}${pathname}`
      : yaml;
  } catch {
    return yaml;
  }
}
