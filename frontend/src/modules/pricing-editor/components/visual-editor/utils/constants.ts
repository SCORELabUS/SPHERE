export const CURRENCIES: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
  CHF: 'CHF', CNY: '¥', SEK: 'kr', NZD: 'NZ$',
};

export const FAST_SPRING = { type: 'spring' as const, stiffness: 800, damping: 35 };

export const FEATURE_TYPES = ['INFORMATION', 'INTEGRATION', 'DOMAIN', 'AUTOMATION', 'MANAGEMENT', 'GUARANTEE', 'SUPPORT', 'PAYMENT'] as const;
export const VALUE_TYPES = ['BOOLEAN', 'TEXT', 'NUMERIC'] as const;
export const USAGE_LIMIT_TYPES = ['RENEWABLE', 'NON_RENEWABLE'] as const;

export const LABEL_WIDTH = 240;
export const TRAILING_WIDTH = 60;

export const INPUT_CLS = "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white";
