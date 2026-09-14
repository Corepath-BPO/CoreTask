/**
 * The currencies a number field can be formatted in.
 *
 * Read from the runtime where it can say — `Intl.supportedValuesOf` knows
 * every code the browser can render a symbol for — and from a short list of
 * the codes a team is likely to reach for where it cannot. The fallback is not
 * the whole ISO table, because a picker of a hundred and eighty codes is not
 * better than one of twenty when nineteen of them will never be chosen.
 */
const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'INR',
  'PHP',
  'SGD',
  'HKD',
  'NZD',
  'SEK',
  'NOK',
  'DKK',
  'MXN',
  'BRL',
  'ZAR',
  'KRW',
];

export function currencyCodes(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('currency');
    if (supported && supported.length > 0) {
      // The common ones first, then the rest alphabetically, so "USD" is not
      // three screens down a list that starts at AED.
      const rest = supported.filter((code) => !COMMON_CURRENCIES.includes(code)).sort();
      return [...COMMON_CURRENCIES.filter((code) => supported.includes(code)), ...rest];
    }
  } catch {
    // Fall through to the curated list.
  }
  return [...COMMON_CURRENCIES];
}

/** "€" for EUR, "$" for USD, or the code itself when the runtime has no symbol. */
export function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}
