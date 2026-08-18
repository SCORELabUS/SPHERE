/**
 * Vocabulary of the Pricing2Yaml 3.x syntax.
 *
 * These lists mirror `pricing4ts`' validators, which are the runtime source of
 * truth: the editor must not flag as invalid anything the parser accepts, nor
 * accept anything it rejects.
 */

export const SUPPORTED_SYNTAX_VERSIONS = ['3.0', '3.1'] as const;

export const VALUE_TYPES = ['BOOLEAN', 'NUMERIC', 'TEXT'] as const;

export const FEATURE_TYPES = [
  'INFORMATION',
  'INTEGRATION',
  'DOMAIN',
  'AUTOMATION',
  'MANAGEMENT',
  'GUARANTEE',
  'SUPPORT',
  'PAYMENT',
] as const;

export const INTEGRATION_TYPES = [
  'API',
  'EXTENSION',
  'IDENTITY_PROVIDER',
  'WEB_SAAS',
  'MARKETPLACE',
  'EXTERNAL_DEVICE',
] as const;

export const AUTOMATION_TYPES = ['BOT', 'FILTERING', 'TRACKING', 'TASK_AUTOMATION'] as const;

export const PAYMENT_TYPES = [
  'CARD',
  'GATEWAY',
  'INVOICE',
  'ACH',
  'WIRE_TRANSFER',
  'OTHER',
] as const;

export const USAGE_LIMIT_TYPES = ['RENEWABLE', 'NON_RENEWABLE'] as const;

export const PERIOD_UNITS = ['SEC', 'MIN', 'HOUR', 'DAY', 'MONTH', 'YEAR'] as const;

export const RENDER_MODES = ['AUTO', 'ENABLED', 'DISABLED'] as const;

export const MIN_NAME_LENGTH = 3;
export const MAX_NAME_LENGTH = 255;

/** Matches the `#variableName` placeholders accepted inside price expressions. */
export const PRICE_VARIABLE_REGEXP = /#([a-zA-Z][a-zA-Z0-9]*)/g;

export const VERSION_REGEXP = /^\d+\.\d+$/;

/** Active ISO 4217 alphabetic codes, as bundled with `currency-codes`. */
export const ISO_4217_CODES = new Set<string>([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOV',
  'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHE', 'CHF',
  'CHW', 'CLF', 'CLP', 'CNY', 'COP', 'COU', 'CRC', 'CUC', 'CUP', 'CVE',
  'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD',
  'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD',
  'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD',
  'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD',
  'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA',
  'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MXV',
  'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB',
  'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB',
  'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS',
  'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND',
  'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'USN', 'UYI',
  'UYU', 'UYW', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XAG',
  'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XDR', 'XOF', 'XPD', 'XPF',
  'XPT', 'XSU', 'XTS', 'XUA', 'XXX', 'YER', 'ZAR', 'ZMW', 'ZWG',]);

/** Formats an allowed-value list for diagnostic messages. */
export function listOptions(options: readonly string[]): string {
  return options.join(', ');
}
