export interface Currency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

export const CURRENCIES: Currency[] = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', flag: '🇨🇭' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', flag: '🇹🇭' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', flag: '🇲🇾' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', flag: '🇵🇭' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', flag: '🇰🇷' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', flag: '🇸🇦' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', flag: '🇧🇷' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', flag: '🇲🇽' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', flag: '🇳🇿' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', flag: '🇸🇪' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', flag: '🇳🇴' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', flag: '🇩🇰' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', flag: '🇭🇰' },
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$', flag: '🇹🇼' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', flag: '🇹🇷' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', flag: '🇷🇺' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', flag: '🇵🇱' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', flag: '🇨🇿' },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

/** Precision for the supported ISO currencies. Version-1 ledger money uses this registry. */
export function getCurrencyPrecision(code: string): number {
  if (!CURRENCY_CODES.includes(code)) throw new Error('INVALID_CURRENCY');
  return code === 'JPY' || code === 'KRW' ? 0 : 2;
}

export function getCurrency(code: string): Currency | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

export function formatCurrency(amount: number, currencyCode: string): string {
  const precision = CURRENCY_CODES.includes(currencyCode) ? getCurrencyPrecision(currencyCode) : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

/** Decimal places a number is written with: 10.555 has 3, 1.5e-7 has 8. */
function decimalPlaces(value: number): number {
  const [mantissa, exponent = '0'] = String(Math.abs(value)).toLowerCase().split('e');
  return Math.max(0, (mantissa.split('.')[1] ?? '').length - Number(exponent));
}

/**
 * Money as entered (#537): in its currency's places, or with every decimal it has when it has
 * more, so an amount that can't be kept as it is ("₹10.555") never reads as one that can.
 */
export function formatCurrencyAsEntered(amount: number, currencyCode: string): string {
  const precision = CURRENCY_CODES.includes(currencyCode) ? getCurrencyPrecision(currencyCode) : 2;
  const places = Math.min(Math.max(precision, decimalPlaces(amount)), 20);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount}`;
  }
}

/**
 * Get currencies sorted with group currencies first
 */
export function getSortedCurrencies(
  defaultCurrency: string,
  alternateCurrencies: string[] = [],
): Currency[] {
  const groupCurrencyCodes = [defaultCurrency, ...alternateCurrencies];
  const groupCurrencies = groupCurrencyCodes
    .map((code) => getCurrency(code))
    .filter(Boolean) as Currency[];
  const otherCurrencies = CURRENCIES.filter((c) => !groupCurrencyCodes.includes(c.code));
  return [...groupCurrencies, ...otherCurrencies];
}

/** The whole unit of a currency with no smaller one ("yen", "won"), else null (#719). */
export function wholeUnit(currency: string): string | null {
  if (!CURRENCY_CODES.includes(currency) || getCurrencyPrecision(currency) !== 0) return null;
  return ({ JPY: 'yen', KRW: 'won' } as Record<string, string>)[currency] ?? currency;
}

/**
 * An amount as a screen reader should say it, with its currency: "2,500 Japanese yen", or just
 * "Japanese yen" before one is typed (#719). The digits are the ones typed, grouped and padded
 * to the currency's decimal places but never computed with, so a refused amount is read as typed.
 */
export function amountReadAloud(typed: string, currency: string): string {
  const places = CURRENCY_CODES.includes(currency) ? getCurrencyPrecision(currency) : 2;
  // The currency's name as it follows an amount: "Japanese yen", "euros", "Indian rupees".
  const name =
    new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'name' })
      .formatToParts(2)
      .find((part) => part.type === 'currency')?.value ?? currency;
  const plain = typed.trim().replaceAll(',', '');
  if (!plain) return name;
  const digits = /^(\d*)(?:\.(\d*))?$/.exec(plain);
  if (!digits || !(digits[1] || digits[2])) return `${typed.trim()} ${name}`;
  const whole = (digits[1] || '0').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (digits[2] ?? '').padEnd(places, '0');
  return `${whole}${fraction ? `.${fraction}` : ''} ${name}`;
}
