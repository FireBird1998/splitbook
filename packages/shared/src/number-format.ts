/**
 * One `Intl.NumberFormat` for each locale and set of options (#373). Android runs the shared code
 * on Hermes, where building a formatter takes milliseconds: a Group's list of Expenses built one
 * for every amount it shows. An option an engine refuses, such as an unknown currency, throws
 * here as it did, and nothing is kept for it.
 */
const formats = new Map<string, Intl.NumberFormat>();
/** Far more than the currencies and precisions any screen shows; past it, start again. */
const MOST_KEPT = 500;

export function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    if (formats.size >= MOST_KEPT) formats.clear();
    formats.set(key, format);
  }
  return format;
}
