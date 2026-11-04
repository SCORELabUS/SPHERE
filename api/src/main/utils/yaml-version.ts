const VERSION_LINE = /^version:.*$/m;

/** What a version label may look like: it is a path segment of the pricing's URLs. */
export const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/**
 * Replaces the top-level `version` of a Pricing2Yaml text, or inserts it after
 * `saasName` when absent, leaving the rest of the document untouched. SPHERE
 * stores a version under the label its YAML gives, so naming a version means
 * writing it there.
 */
export function stampVersion(yamlText: string, version: string): string {
  const line = `version: ${JSON.stringify(version)}`;
  if (VERSION_LINE.test(yamlText)) return yamlText.replace(VERSION_LINE, () => line);
  const saasName = /^saasName:.*$/m.exec(yamlText);
  if (!saasName) return `${line}\n${yamlText}`;
  const end = saasName.index + saasName[0].length;
  return `${yamlText.slice(0, end)}\n${line}${yamlText.slice(end)}`;
}
