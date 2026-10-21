import { PRODUCT_NAME } from '../product';

/** Under Record, on the Record payment and Settle up sheets. */
export const recordPaymentFootnote = `Records a payment made outside ${PRODUCT_NAME}. No money moves.`;
/** Record's reason while the sheet checks the latest balances (#334). */
export const recordWaitsForCheck = 'Record is available once the latest balances are checked.';
/** Retry's, for an unconfirmed payment found on this phone. */
export const retryWaitsForCheck = 'Retry is available once the latest balances are checked.';
/** What the sheet says while it checks them. */
export const checkingBalances = 'Checking the latest balances…';
