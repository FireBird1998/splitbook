import { describe, expect, it } from 'vitest';
import type { SettlementLedger } from '@splitbook/shared/settlement-preview';
import {
  amountInputText,
  checkNewPayment,
  overpaymentMessage,
  partyProblem,
  readPaymentAmount,
  type LedgerState,
  type NewPaymentDraft,
} from './record-payment';

/*
 * The Record payment form's rules (#312), without React: reading the amount typed, the
 * parties-only rule, and what the form says about a new payment before Record may send it.
 */

const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const names: Record<string, string> = { [YOU]: 'You', [SAM]: 'Sam Chen', [PRIYA]: 'Priya Shah' };
const nameOf = (id: string) => names[id] ?? 'Former member';

/** You owe 1,480.00: 1,060.00 to Sam and 420.00 to Priya. */
const maple: SettlementLedger = {
  balances: [
    { userId: YOU, amountMinor: -148000 },
    { userId: SAM, amountMinor: 106000 },
    { userId: PRIYA, amountMinor: 42000 },
  ],
  suggestions: [
    { from: YOU, to: SAM, amountMinor: 106000 },
    { from: YOU, to: PRIYA, amountMinor: 42000 },
  ],
};
const ready: LedgerState = { status: 'ready', ledger: maple };

const check = (draft: Partial<NewPaymentDraft>, ledger: LedgerState = ready) =>
  checkNewPayment(
    { from: YOU, to: SAM, amount: '', note: '', ack: false, ...draft },
    { viewerId: YOU, currency: 'INR', ledger, nameOf },
  );

describe('readPaymentAmount', () => {
  it('reads plain and grouped amounts exactly', () => {
    expect(readPaymentAmount('1060', 'INR')).toEqual({ status: 'valid', amountMinor: 106000 });
    expect(readPaymentAmount(' 1,060.50 ', 'INR')).toEqual({
      status: 'valid',
      amountMinor: 106050,
    });
    expect(readPaymentAmount('1,234,567.8', 'USD')).toEqual({
      status: 'valid',
      amountMinor: 123456780,
    });
    expect(readPaymentAmount('.5', 'EUR')).toEqual({ status: 'valid', amountMinor: 50 });
    expect(readPaymentAmount('0.01', 'INR')).toEqual({ status: 'valid', amountMinor: 1 });
    expect(readPaymentAmount('1060', 'JPY')).toEqual({ status: 'valid', amountMinor: 1060 });
  });

  it('is empty until something is typed', () => {
    expect(readPaymentAmount('', 'INR')).toEqual({ status: 'empty' });
    expect(readPaymentAmount('   ', 'INR')).toEqual({ status: 'empty' });
  });

  it('never reads a comma as a decimal point', () => {
    for (const typed of ['10,50', '1,06', '1,0600.00', ',5', '1,,000']) {
      expect(readPaymentAmount(typed, 'INR')).toEqual({
        status: 'invalid',
        message: 'Enter an amount like 1,060.00.',
      });
    }
  });

  it('refuses signs, exponents, words and currency symbols', () => {
    for (const typed of ['-5', '+5', '1e3', 'ten', '₹100', '1 000', '1.2.3']) {
      expect(readPaymentAmount(typed, 'INR').status).toBe('invalid');
    }
  });

  it('refuses more decimal places than the currency has', () => {
    expect(readPaymentAmount('10.005', 'INR')).toEqual({
      status: 'invalid',
      message: 'Use at most 2 decimal places.',
    });
    expect(readPaymentAmount('10.5', 'JPY')).toEqual({
      status: 'invalid',
      message: 'JPY amounts have no decimal places.',
    });
    expect(readPaymentAmount('1,060.5', 'KRW')).toMatchObject({ status: 'invalid' });
  });

  it('refuses zero and anything above the largest amount', () => {
    expect(readPaymentAmount('0', 'INR')).toEqual({
      status: 'invalid',
      message: 'Enter an amount above ₹0.00.',
    });
    expect(readPaymentAmount('0.00', 'USD')).toEqual({
      status: 'invalid',
      message: 'Enter an amount above $0.00.',
    });
    expect(readPaymentAmount('10000000', 'INR')).toEqual({
      status: 'valid',
      amountMinor: 1_000_000_000,
    });
    expect(readPaymentAmount('10000000.01', 'INR')).toEqual({
      status: 'invalid',
      message: 'Enter at most ₹10,000,000.00.',
    });
  });
});

describe('amountInputText', () => {
  it('writes an exact amount with the currency’s places and no grouping', () => {
    expect(amountInputText(106000, 'INR')).toBe('1060.00');
    expect(amountInputText(25025, 'USD')).toBe('250.25');
    expect(amountInputText(1060, 'JPY')).toBe('1060');
  });
});

describe('partyProblem', () => {
  it('lets the member record a payment they are part of, either way', () => {
    expect(partyProblem(YOU, YOU, SAM, nameOf)).toBeNull();
    expect(partyProblem(YOU, SAM, YOU, nameOf)).toBeNull();
  });

  it('refuses a payment between two other members, naming who can record it', () => {
    expect(partyProblem(YOU, SAM, PRIYA, nameOf)).toBe(
      'Only Sam or Priya can record a payment between them.',
    );
  });

  it('refuses the same person on both sides, and says nothing until both are chosen', () => {
    expect(partyProblem(YOU, SAM, SAM, nameOf)).toBe('Pick two different people.');
    expect(partyProblem(YOU, YOU, '', nameOf)).toBeNull();
  });
});

describe('overpaymentMessage', () => {
  it('says how much more than suggested, and where the payer stands afterwards', () => {
    const { overpayment } = check({ amount: '1200' });
    expect(overpayment).toBe(
      'That’s ₹140.00 more than suggested. Afterwards you’d still owe ₹280.00 in this Group.',
    );
    expect(check({ amount: '1480', to: SAM }).overpayment).toBe(
      'That’s ₹420.00 more than suggested. Afterwards you’d be settled up in this Group.',
    );
  });

  it('names the payer when it is someone else, and says when nothing was suggested', () => {
    expect(check({ from: SAM, to: YOU, amount: '50' }).overpayment).toBe(
      'No payment from Sam to you is suggested. Afterwards Sam would be owed ₹1,110.00 in this Group.',
    );
    const preview = check({ from: YOU, to: PRIYA, amount: '2000' }).preview!;
    expect(overpaymentMessage(preview, 'INR', { isViewer: true, name: 'You' }, 'Priya Shah')).toBe(
      'That’s ₹1,580.00 more than suggested. Afterwards you’d be owed ₹520.00 in this Group.',
    );
  });
});

describe('checkNewPayment', () => {
  it('is ready for the suggested amount, with the suggestion and positions after', () => {
    const result = check({ amount: '1060.00' });
    expect(result).toMatchObject({
      partyError: null,
      suggestedMinor: 106000,
      overpayment: null,
      waitingFor: null,
      ready: true,
    });
    expect(result.preview).toMatchObject({
      paidBy: { afterMinor: -42000 },
      paidTo: { afterMinor: 0 },
    });
  });

  it('waits for the tick before recording an overpayment, and only then', () => {
    expect(check({ amount: '1200' })).toMatchObject({
      ready: false,
      waitingFor: 'Tick “I meant to pay more than suggested” first.',
    });
    expect(check({ amount: '1200', ack: true })).toMatchObject({ ready: true, waitingFor: null });
    // A tick given for one amount doesn't matter when the amount no longer overpays.
    expect(check({ amount: '100', ack: true })).toMatchObject({ ready: true, overpayment: null });
  });

  it('says what is missing, one thing at a time', () => {
    expect(check({ to: '' }).waitingFor).toBe('Choose who paid whom.');
    expect(check({}).waitingFor).toBe('Enter the amount paid.');
    expect(check({ amount: '10' }, { status: 'loading' })).toMatchObject({
      ready: false,
      waitingFor: 'Loading the latest balances…',
    });
    expect(check({ amount: '10' }, { status: 'error' })).toMatchObject({
      ready: false,
      waitingFor: 'Balances could not be loaded, so this payment can’t be checked yet.',
    });
  });

  it('never records a payment between two other members, whatever the amount', () => {
    const result = check({ from: SAM, to: PRIYA, amount: '10', ack: true });
    expect(result).toMatchObject({
      partyError: 'Only Sam or Priya can record a payment between them.',
      suggestedMinor: null,
      preview: null,
      ready: false,
      waitingFor: null,
    });
  });

  it('keeps a note to the server’s 500 characters', () => {
    expect(check({ amount: '10', note: 'x'.repeat(500) })).toMatchObject({
      noteError: null,
      ready: true,
    });
    expect(check({ amount: '10', note: 'x'.repeat(501) })).toMatchObject({
      noteError: 'Keep the note to 500 characters (501 now).',
      ready: false,
    });
  });

  it('refuses an amount it can’t read, and never treats it as zero', () => {
    expect(check({ amount: '10,50' })).toMatchObject({
      amount: { status: 'invalid' },
      preview: null,
      ready: false,
    });
  });
});
