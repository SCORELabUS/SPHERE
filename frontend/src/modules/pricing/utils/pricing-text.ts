import { Pricing, retrievePricingFromYaml } from 'pricing4ts';

/**
 * A pricing parsed from its YAML text: in the browser when it can, and
 * otherwise by the API, which upgrades older syntaxes. The request carries no
 * credentials or Referer, so it can be made from an anonymous page.
 */
export async function parsePricingText(text: string): Promise<Pricing> {
  try {
    return retrievePricingFromYaml(text);
  } catch {
    const response = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/pricings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({ pricing: text }),
    });
    if (!response.ok) throw new Error('Failed to parse pricing');
    return response.json();
  }
}

/** The YAML with its `variables:` block replaced (or added), as the renderer applies them. */
export function applyVariablesToYaml(yaml: string, variables: Record<string, unknown>): string {
  const serialize = (value: unknown) => {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return JSON.stringify(value);
  };
  const block = ['variables:', ...Object.keys(variables).map(key => `  ${key}: ${serialize(variables[key])}`)].join('\n');
  const existing = /^variables:\n(?:[ \t]+.+\n?)*/m;
  return existing.test(yaml) ? yaml.replace(existing, block + '\n') : yaml + '\n' + block + '\n';
}
