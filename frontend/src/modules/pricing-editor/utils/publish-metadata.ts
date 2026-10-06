import { formatCreatedAt } from '../services/pricing2yaml/created-at';

const TOP_LEVEL_KEY = (key: string) => new RegExp(`^${key}:.*$`, 'm');

/** Replaces a top-level scalar in a YAML text, or inserts it when absent, leaving the rest untouched. */
function setTopLevelScalar(yaml: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  if (TOP_LEVEL_KEY(key).test(yaml)) return yaml.replace(TOP_LEVEL_KEY(key), () => line);
  const saasName = TOP_LEVEL_KEY('saasName').exec(yaml);
  if (!saasName) return `${line}\n${yaml}`;
  const end = saasName.index + saasName[0].length;
  return `${yaml.slice(0, end)}\n${line}${yaml.slice(end)}`;
}

/**
 * Stamps the release metadata of a version into its YAML. `createdAt` carries the
 * exact release instant (UTC), the same one sent as the `createdAt` form field,
 * so the version SPHERE stores and the YAML it serves always agree.
 */
export function stampVersionMetadata(yaml: string, version: string, releasedAt: Date): string {
  const quotedVersion = `"${version.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const withVersion = setTopLevelScalar(yaml, 'version', quotedVersion);
  return setTopLevelScalar(withVersion, 'createdAt', `"${formatCreatedAt(releasedAt)}"`);
}

/** Value for an `<input type="datetime-local">`, in the user's local time. */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
