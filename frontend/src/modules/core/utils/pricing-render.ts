import { retrievePricingFromYaml, type Pricing } from 'pricing4ts';

/**
 * A pricing's YAML read for `PricingRenderer`, as the Overview reads it: in the
 * browser, or by the API when the browser's parser refuses it (a syntax it does
 * not read, say).
 */
export async function parsePricingForRender(text: string): Promise<Pricing> {
  try {
    return retrievePricingFromYaml(text);
  } catch {
    const response = await fetch('/api/v1/pricings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pricing: text }),
    });
    if (!response.ok) throw new Error('Failed to parse pricing');
    return (await response.json()) as Pricing;
  }
}

const serializeVariable = (value: unknown) => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return JSON.stringify(value);
};

/** The YAML with its `variables` block replaced by these values (or one added), for the variables simulator. */
export function withVariables(yaml: string, variables: Record<string, unknown>): string {
  const lines = ['variables:'];
  for (const key of Object.keys(variables)) lines.push(`  ${key}: ${serializeVariable(variables[key])}`);
  const block = lines.join('\n');
  const existing = /^variables:\n(?:[ \t]+.+\n?)*/gm;
  return existing.test(yaml) ? yaml.replace(existing, block + '\n') : yaml + '\n' + block + '\n';
}
