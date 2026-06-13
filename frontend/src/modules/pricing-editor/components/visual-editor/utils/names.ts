export function toCamelCase(s: string): string {
  const trimmed = s.trim().replace(/[^a-zA-Z0-9\s]/g, '');
  if (!trimmed) return '';
  return trimmed
    .replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^\s*/, '')
    .replace(/^./, c => c.toLowerCase());
}

export function getNextName(prefix: string, existingKeys: string[]): string {
  let i = 1;
  while (existingKeys.includes(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}
