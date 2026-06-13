export function getColorForIndex(index: number): string {
  const palette = [
    '#fa520f', // orange (primary)
    '#e68a00', // amber
    '#14b8a6', // teal
    '#0ea5e9', // sky
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#059669', // emerald
    '#ef4444', // red
    '#ffa110', // sunshine
  ];
  return palette[index % palette.length];
}

export function indexFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
