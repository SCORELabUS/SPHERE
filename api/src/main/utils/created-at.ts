const CREATED_AT_LINE = /^createdAt:.*$/m;

/**
 * Pricing2Yaml's `createdAt` is a date (`yyyy-mm-dd`) or an ISO 8601 date-time.
 * SPHERE stores the same instant in its database, so it is written back to the
 * YAML whenever the two differ: consumers that compare them (SPACE does) must
 * always find the same value.
 */
export function formatCreatedAt(createdAt: Date): string {
  const iso = createdAt.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/**
 * Replaces the top-level `createdAt` of a YAML text, or inserts it when absent,
 * leaving the rest of the document (comments, order, quoting) untouched.
 */
export function stampCreatedAt(yamlText: string, createdAt: Date): string {
  const line = `createdAt: "${formatCreatedAt(createdAt)}"`;
  if (CREATED_AT_LINE.test(yamlText)) return yamlText.replace(CREATED_AT_LINE, () => line);
  const saasName = /^saasName:.*$/m.exec(yamlText);
  if (!saasName) return `${line}\n${yamlText}`;
  const end = saasName.index + saasName[0].length;
  return `${yamlText.slice(0, end)}\n${line}${yamlText.slice(end)}`;
}
