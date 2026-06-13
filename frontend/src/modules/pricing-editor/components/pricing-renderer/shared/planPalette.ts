// planPalette.ts – brand-aligned gradient palette for plan headers
const PALETTE: Array<[string, string, string]> = [
  ['#fa520f', '#cc3a05', '#a32e04'], // orange (primary)
  ['#e68a00', '#b36b00', '#8a5200'], // sunshine / amber
  ['#14b8a6', '#0f766e', '#0b6158'], // teal
  ['#0ea5e9', '#0369a1', '#075985'], // sky
  ['#8b5cf6', '#6d28d9', '#4c1d95'], // violet
  ['#ec4899', '#be185d', '#9d174d'], // pink
  ['#059669', '#047857', '#065f46'], // emerald
  ['#ef4444', '#b91c1c', '#7f1d1d'], // red
];

export function getPlanGradient(index: number): string {
  const [a, b] = PALETTE[index % PALETTE.length];
  return `linear-gradient(90deg, ${a}, ${b})`;
}

export function getPlanAccent(index: number): string {
  return PALETTE[index % PALETTE.length][2];
}

export default PALETTE;
