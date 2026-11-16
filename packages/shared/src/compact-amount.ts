/**
 * How amounts are written where room is short (#1272): the "Number rules" table on the Spending
 * by day board `SpendAndSettings`. Amounts are exact minor units of their own currency.
 */

/** An amount in full, as the app writes money everywhere: `₹1,421,780.00`, `PLN 60.00`. */
export function fullAmount(amountMinor: number, currency: string): string {
  void amountMinor;
  void currency;
  throw new Error('Not built yet');
}

/** An amount shortened: `₹14.2L`, `€1.25M`, `¥186K`. */
export function shortAmount(amountMinor: number, currency: string): string {
  void amountMinor;
  void currency;
  throw new Error('Not built yet');
}

/** An amount in full when it fits in `maxLength` characters, else shortened. */
export function amountToFit(amountMinor: number, currency: string, maxLength: number): string {
  void amountMinor;
  void currency;
  void maxLength;
  throw new Error('Not built yet');
}

/** A day's share in a calendar cell: `420`, `45,000`, `1.25L`, `<1`, or nothing. */
export function dayCellAmount(amountMinor: number, currency: string, maxLength: number): string {
  void amountMinor;
  void currency;
  void maxLength;
  throw new Error('Not built yet');
}
