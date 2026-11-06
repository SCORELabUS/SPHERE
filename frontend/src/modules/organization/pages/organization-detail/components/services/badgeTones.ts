// The badges of the service tree (type, channel, pricing) share one look: a
// darker border, a light fill and strong text, all in the same color. A new
// color is one entry here. Spelled out so Tailwind finds every class.
//
// No `dark:` classes: the app adds `.dark` to <html> when the system is dark,
// but its palette has no dark version yet (see the commented-out `.dark` block
// in styles/tailwind.css), so they would put dark badges on a light page. Add
// them here when SPHERE's dark mode is turned on.

export const BADGE_TONES = {
  emerald: 'border-emerald-600 bg-emerald-50 text-emerald-700',
  sky: 'border-sky-600 bg-sky-50 text-sky-700',
  violet: 'border-violet-600 bg-violet-50 text-violet-700',
  amber: 'border-amber-600 bg-amber-50 text-amber-700',
  rose: 'border-rose-600 bg-rose-50 text-rose-700',
  indigo: 'border-indigo-600 bg-indigo-50 text-indigo-700',
  neutral: 'border-tp-hairline-strong bg-tp-surface text-tp-slate',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

/** The shape every badge of the tree shares; add a tone from BADGE_TONES. */
export const BADGE_SHAPE =
  'inline-flex items-center rounded-full border px-2 py-px font-sans text-[11px] font-semibold leading-4';
