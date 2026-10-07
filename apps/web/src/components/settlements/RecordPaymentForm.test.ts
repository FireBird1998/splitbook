import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettlementLedger } from '@splitbook/shared/settlement-preview';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import type { SettlementAttempt } from '@/lib/settlement-attempts';
import type { LedgerState } from './record-payment';
import RecordPaymentForm, { type RecordPaymentStart } from './RecordPaymentForm';

/*
 * Record payment on the Balances tab (#312), rendered to static markup as the server renders it:
 * each state of the form, the overpayment tick gating Record, the parties-only rule, and a
 * stored payment whose reply was lost, shown read-only for an explicit resend.
 */

const GROUP = 'b00000000000000000000010';
const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';

const stored = vi.hoisted(() => ({ attempts: [] as unknown[] }));
vi.mock('@/lib/hooks/use-settlement-attempts', () => ({
  useSettlementAttempts: () => stored.attempts,
}));

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

function render(
  start: Partial<RecordPaymentStart>,
  options: { ledger?: LedgerState; currency?: string; outcome?: string } = {},
) {
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(RecordPaymentForm, {
        groupId: GROUP,
        groupName: 'Maple House',
        accountId: YOU,
        currency: options.currency ?? 'INR',
        members: [
          { id: YOU, name: 'Alex Rivera' },
          { id: SAM, name: 'Sam Chen' },
          { id: PRIYA, name: 'Priya Shah' },
        ],
        ledger: options.ledger ?? { status: 'ready', ledger: maple },
        start: { from: YOU, to: '', ...start },
        outcome: options.outcome,
        onDone: () => {},
        onRefresh: () => {},
      }),
    ),
  );
  return { html, text: text(html) };
}

/** Every button: its text, and whether it is disabled. */
function buttons(html: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => ({
    text: text(inner),
    disabled: /\sdisabled=""/.test(attrs),
  }));
}

const record = (html: string) =>
  buttons(html).find((button) => button.text.startsWith('Record payment'));

/** The value and read-only state of an input or the selected option of a select, by id. */
function field(html: string, id: string) {
  const input = new RegExp(`<input\\b[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0];
  if (input) {
    return {
      value: /\svalue="([^"]*)"/.exec(input)?.[1] ?? '',
      readOnly: /\sreadOnly=""|\sreadonly=""/.test(input),
      invalid: /\saria-invalid="true"/.test(input),
    };
  }
  const select = new RegExp(`<select\\b[^>]*\\sid="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  const chosen = select && /<option[^>]*selected=""[^>]*>([^<]*)<\/option>/.exec(select[1]);
  return { value: chosen?.[1] ?? '', readOnly: false, invalid: false };
}

function attempt(overrides: Partial<SettlementAttempt> = {}): SettlementAttempt {
  const payment = {
    paidBy: YOU,
    paidTo: SAM,
    amount: 250.25,
    currency: 'INR',
    note: 'Paid via UPI',
    ...overrides,
  };
  return {
    paidByName: 'Alex Rivera',
    paidToName: 'Sam Chen',
    accountId: YOU,
    groupId: GROUP,
    key: 'synthetic-key-0001',
    body: JSON.stringify(payment),
    ...payment,
    ...overrides,
  };
}

beforeEach(() => {
  stored.attempts = [];
});

describe('a new payment', () => {
  it('starts blank: From is the member, To is to be chosen, and Record waits', () => {
    const { html, text: shown } = render({});
    expect(field(html, 'record-payment-from').value).toBe('You');
    expect(field(html, 'record-payment-to').value).toBe('Choose');
    expect(field(html, 'record-payment-amount')).toMatchObject({ value: '', readOnly: false });
    expect(record(html)).toEqual({ text: 'Record payment', disabled: true });
    expect(shown).toContain('Choose who paid whom.');
    expect(shown).toContain('Maple House · INR');
    expect(shown).toContain('Records a payment made outside Splitbook. No money moves.');
    expect(shown).not.toContain('After this payment');
  });

  it('a suggested payment fills in the suggestion, shows the positions after, and can be recorded', () => {
    const { html, text: shown } = render({ to: SAM, amount: '1060.00' });
    expect(field(html, 'record-payment-to').value).toBe('Sam Chen');
    expect(field(html, 'record-payment-amount').value).toBe('1060.00');
    expect(shown).toContain('Suggested ₹1,060.00');
    expect(shown).toContain('After this payment You owe ₹420.00 Sam Chen is settled up');
    expect(shown).toContain('Either of you can record it. Sam will see it in Activity.');
    expect(shown).not.toContain('more than suggested.');
    expect(record(html)).toEqual({ text: 'Record payment ₹1,060.00', disabled: false });
  });

  it('paying more than suggested warns, and Record waits for the tick', () => {
    const { html, text: shown } = render({ to: SAM, amount: '1200' });
    expect(shown).toContain(
      'That’s ₹140.00 more than suggested. Afterwards you’d still owe ₹280.00 in this Group.',
    );
    expect(shown).toContain('I meant to pay more than suggested');
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(record(html)).toEqual({ text: 'Record payment ₹1,200.00', disabled: true });
    expect(shown).toContain('Tick “I meant to pay more than suggested” first.');
    expect(shown).toContain('After this payment You owe ₹280.00 Sam Chen owes ₹140.00');
  });

  it('once ticked, the overpayment can be recorded', () => {
    const { html, text: shown } = render({ to: SAM, amount: '1200', ack: true });
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(record(html)).toEqual({ text: 'Record payment ₹1,200.00', disabled: false });
    expect(shown).not.toContain('first.');
  });

  it('a payment nobody suggested is an overpayment too', () => {
    const { html, text: shown } = render({ from: SAM, to: YOU, amount: '50' });
    expect(shown).toContain(
      'No payment from Sam to you is suggested. Afterwards Sam would be owed ₹1,110.00 in this Group.',
    );
    expect(record(html)?.disabled).toBe(true);
  });

  it('only a pair that includes the member can be recorded', () => {
    const { html, text: shown } = render({ from: SAM, to: PRIYA, amount: '100', ack: true });
    expect(shown).toContain('Only Sam or Priya can record a payment between them.');
    expect(record(html)?.disabled).toBe(true);
    expect(shown).not.toContain('After this payment');
    expect(shown).not.toContain('Suggested');
    expect(shown).not.toContain('will see it in Activity');
  });

  it('refuses the same person on both sides', () => {
    const { html, text: shown } = render({ from: SAM, to: SAM, amount: '100' });
    expect(shown).toContain('Pick two different people.');
    expect(record(html)?.disabled).toBe(true);
  });

  it('marks an amount it can’t read, and never records it', () => {
    const { html, text: shown } = render({ to: SAM, amount: '10,50' });
    expect(field(html, 'record-payment-amount').invalid).toBe(true);
    expect(html).toContain('aria-describedby="record-payment-amount-error"');
    expect(shown).toContain('Enter an amount like 1,060.00.');
    expect(record(html)).toEqual({ text: 'Record payment', disabled: true });
  });

  it('keeps a note to 500 characters', () => {
    const { html, text: shown } = render({ to: SAM, amount: '100', note: 'x'.repeat(501) });
    expect(shown).toContain('Keep the note to 500 characters (501 now).');
    expect(record(html)?.disabled).toBe(true);
  });

  it('waits for the balances before checking a new payment', () => {
    const loading = render({ to: SAM, amount: '100' }, { ledger: { status: 'loading' } });
    expect(loading.text).toContain('Loading the latest balances…');
    expect(record(loading.html)?.disabled).toBe(true);
    const failed = render({ to: SAM, amount: '100' }, { ledger: { status: 'error' } });
    expect(failed.text).toContain(
      'Balances could not be loaded, so this payment can’t be checked yet.',
    );
    expect(record(failed.html)?.disabled).toBe(true);
  });

  it('records in the Group’s currency only, with that currency’s places', () => {
    const yen: SettlementLedger = {
      balances: [
        { userId: YOU, amountMinor: -1060 },
        { userId: SAM, amountMinor: 1060 },
      ],
      suggestions: [{ from: YOU, to: SAM, amountMinor: 1060 }],
    };
    const { html, text: shown } = render(
      { to: SAM, amount: '1060' },
      { currency: 'JPY', ledger: { status: 'ready', ledger: yen } },
    );
    expect(html).toContain('aria-label="Currency JPY, the Group’s currency"');
    expect(shown).toContain('Suggested ¥1,060');
    expect(record(html)).toEqual({ text: 'Record payment ¥1,060', disabled: false });
  });

  it('shows what the last payment came to when it starts afresh', () => {
    const { html } = render({}, { outcome: 'Payment recorded. You paid Sam Chen ₹250.25.' });
    expect(html).toMatch(
      /role="status"[^>]*>[\s\S]*Payment recorded\. You paid Sam Chen ₹250\.25\./,
    );
  });
});

describe('a payment whose reply was lost', () => {
  it('is shown read-only for its pair, and Record sends it again unchanged', () => {
    stored.attempts = [attempt()];
    const { html, text: shown } = render({ to: SAM, amount: '1060.00' });
    expect(field(html, 'record-payment-amount')).toMatchObject({ value: '250.25', readOnly: true });
    expect(field(html, 'record-payment-note')).toMatchObject({
      value: 'Paid via UPI',
      readOnly: true,
    });
    expect(shown).toContain('Payment not confirmed');
    expect(shown).toContain('This payment may already be recorded.');
    // Opened as a new payment, so the stored one comes first.
    expect(shown).toContain('isn’t confirmed yet, so it comes first');
    expect(record(html)).toEqual({ text: 'Record payment ₹250.25', disabled: false });
    expect(buttons(html).map((button) => button.text)).toContain('Discard this payment');
    // No new-payment checks apply to a resend.
    expect(shown).not.toContain('more than suggested');
    expect(shown).not.toContain('After this payment');
  });

  it('is found for the pair either way round, and shows its own direction', () => {
    stored.attempts = [
      attempt({ paidBy: SAM, paidTo: YOU, paidByName: 'Sam Chen', paidToName: 'Alex Rivera' }),
    ];
    const { html } = render({ from: YOU, to: SAM });
    expect(field(html, 'record-payment-from').value).toBe('Sam Chen');
    expect(field(html, 'record-payment-to').value).toBe('You');
    expect(field(html, 'record-payment-amount').readOnly).toBe(true);
  });

  it('opened to check it, it is not said to come first', () => {
    stored.attempts = [attempt()];
    const { text: shown } = render({ to: SAM, amount: '250.25', purpose: 'check' });
    expect(shown).toContain('This payment may already be recorded.');
    expect(shown).not.toContain('comes first');
  });

  it('opened to check it after it went, sends nothing and offers a new payment', () => {
    const { html, text: shown } = render({ to: SAM, amount: '250.25', purpose: 'check' });
    expect(shown).toContain('confirmed or discarded in another tab');
    expect(field(html, 'record-payment-amount')).toMatchObject({ value: '250.25', readOnly: true });
    expect(record(html)?.disabled).toBe(true);
    expect(buttons(html).map((button) => button.text)).toContain('Start a new payment');
  });

  it('stays with its own pair: another pair records a new payment', () => {
    stored.attempts = [attempt()];
    const { html } = render({ to: PRIYA, amount: '420.00' });
    expect(field(html, 'record-payment-amount')).toMatchObject({
      value: '420.00',
      readOnly: false,
    });
    expect(record(html)).toEqual({ text: 'Record payment ₹420.00', disabled: false });
  });
});

it('names people, never their emails', () => {
  stored.attempts = [attempt()];
  const { text: shown } = render({ to: SAM });
  expect(shown).not.toMatch(/@/);
});
