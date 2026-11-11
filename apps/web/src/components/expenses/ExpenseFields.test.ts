import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import {
  expenseCurrencyChoices,
  type ExpenseCurrencyChoice,
} from '@splitbook/shared/group-currencies';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import ExpenseFields from './ExpenseFields';

/*
 * The Expense form's fields (Add expense, editing an Expense, and To review's editor), rendered
 * to static markup as the server renders them. Fictional people and amounts.
 */

const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';

function render(
  amount: string,
  mode: {
    isEditMode?: boolean;
    multiPayerMode?: boolean;
    review?: boolean;
    currency?: string;
    currencyChoices?: ExpenseCurrencyChoice[];
    currencyHint?: string | null;
    splitMethod?: 'shares' | 'percentage' | 'unequal';
    splitValues?: Record<string, string>;
    payerId?: string;
    payers?: Array<{ user: string; amount: string }>;
  } = {},
) {
  const draft = ExpenseDraft.open({
    groupId: 'b00000000000000000000001',
    accountId: YOU,
    memberIds: [YOU, SAM],
    currency: mode.currency ?? 'INR',
    defaultTag: 'General',
    date: '2026-10-18',
  }).change({
    description: 'Chai',
    ...(mode.splitMethod
      ? { splitMethod: mode.splitMethod, splitValues: mode.splitValues ?? {} }
      : {}),
    payerId: mode.payerId ?? YOU,
    amount,
    multiPayer: mode.multiPayerMode ?? false,
    payers: mode.payers ?? [{ user: YOU, amount }],
  });
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ExpenseFields, {
        entry: draft.entry,
        reading: draft.reading(),
        editEntry: () => {},
        chooseSplitMethod: () => {},
        members: [
          { user: { _id: YOU, name: 'Alex Rivera' } },
          { user: { _id: SAM, name: 'Sam Chen' } },
        ],
        groupTags: [{ _id: 'c00000000000000000000001', name: 'General', isArchived: false }],
        userId: YOU,
        isEditMode: mode.isEditMode ?? false,
        review: mode.review,
        currencyChoices: mode.currencyChoices,
        currencyHint: mode.currencyHint,
      }),
    ),
  );
}

/** The amount field: whether it's marked invalid, and the message it points to, if any. */
function amountField(html: string) {
  const input = /<input\b[^>]*\sinputMode="(?:decimal|numeric)"[^>]*>/.exec(html)![0];
  const described = /\saria-describedby="([^"]*)"/.exec(input)?.[1];
  const reason = /<p\b([^>]*\saria-live="polite"[^>]*)>([\s\S]*?)<\/p>/.exec(html);
  return {
    invalid: /\saria-invalid="true"/.test(input),
    describedBy: !!described && !!reason && reason[1].includes(`id="${described}"`),
    reason: reason ? text(reason[2]) : null,
  };
}

describe('the Expense amount (#528)', () => {
  it('says why it won’t take an amount, in Record payment’s words, announced politely', () => {
    for (const [amount, reason] of [
      ['0', 'Enter an amount above ₹0.00.'],
      ['-5', 'Enter an amount above ₹0.00.'],
      ['1.234', 'Use at most 2 decimal places.'],
      ['20000000', 'Enter at most ₹10,000,000.00.'],
    ])
      expect(amountField(render(amount)), amount).toEqual({
        invalid: true,
        describedBy: true,
        reason,
      });
  });

  it('says the same when editing an Expense and in To review’s editor', () => {
    for (const mode of [{ isEditMode: true }, { review: true }])
      expect(amountField(render('1.234', mode)), JSON.stringify(mode)).toEqual({
        invalid: true,
        describedBy: true,
        reason: 'Use at most 2 decimal places.',
      });
  });

  it('keeps its message region, empty, while the amount is fine or not typed yet', () => {
    for (const amount of ['100', ''])
      expect(amountField(render(amount)), amount).toEqual({
        invalid: false,
        describedBy: false,
        reason: '',
      });
  });
});

/** Lisbon & Tokyo, a fictional Trip in rupees, with euros and yen as extra currencies. */
const trip = { defaultCurrency: 'INR', alternateCurrencies: ['EUR', 'JPY'] };
/** An attribute of the first element whose opening tag matches. */
const attribute = (html: string, tag: RegExp, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag.exec(html)?.[0] ?? '')?.[1] ?? null;
const currencyButton = /<button\b[^>]*aria-haspopup="listbox"[^>]*>/;
const amountInput = /<input\b[^>]*\sinputMode="(?:decimal|numeric)"[^>]*>/;

describe('the Expense’s currency, beside its amount (#719)', () => {
  it('is a button that says the currency and offers to change it, with the symbol before the amount', () => {
    const html = render('2500', {
      currency: 'JPY',
      currencyChoices: expenseCurrencyChoices(trip, 'JPY', 'JPY'),
      currencyHint: 'Started in JPY, the currency of your latest Expense here.',
    });
    expect(attribute(html, currencyButton, 'aria-label')).toBe(
      'Currency, JPY, Japanese Yen. Change currency',
    );
    expect(attribute(html, currencyButton, 'aria-expanded')).toBe('false');
    expect(
      text(currencyButton.exec(html)![0] + html.split(currencyButton)[1].split('</button>')[0]),
    ).toContain('JPY');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>¥<\/span>/);
    // Screen readers hear the amount with its currency.
    expect(attribute(html, amountInput, 'aria-label')).toBe('Amount, 2,500 Japanese yen');
    expect(text(html)).toContain('Started in JPY, the currency of your latest Expense here.');
    // The old separate Currency field is gone: the currency sits in the amount.
    expect(html).not.toMatch(/<label[^>]*>Currency</);
  });

  // #884: "PLN ▾ 60.00" and "CHF ▾ 86.00", never "PLN ▾ zł 60.00" or "CHF ▾ CHF 86.00".
  it.each([
    ['PLN', null],
    ['CHF', null],
    ['EUR', '€'],
  ])(
    'shows %s’s prefix beside the chip only where it isn’t the code the chip says',
    (code, prefix) => {
      const html = render('60', {
        currency: code,
        currencyChoices: expenseCurrencyChoices(
          { defaultCurrency: 'INR', alternateCurrencies: [code] },
          code,
          code,
        ),
      });
      const button = currencyButton.exec(html)![0];
      // What the amount's start shows after the chip: its prefix, or nothing.
      const after = html.split(button)[1].split('</button>').slice(1).join('</button>');
      const beside =
        /^(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*aria-hidden="true"[^>]*>([^<]*)<\/span>/.exec(
          after,
        )?.[1] ?? null;
      expect(beside).toBe(prefix);
      expect(html).not.toContain('zł');
    },
  );

  it('splits whole yen, and refuses part of a yen in the board’s words', () => {
    const choices = expenseCurrencyChoices(trip, null, 'JPY');
    expect(text(render('2500', { currency: 'JPY', currencyChoices: choices }))).toContain(
      'whole yen',
    );
    expect(
      text(
        render('2500', {
          currency: 'INR',
          currencyChoices: expenseCurrencyChoices(trip, null, 'INR'),
        }),
      ),
    ).not.toContain('whole');
    expect(amountField(render('2500.50', { currency: 'JPY', currencyChoices: choices }))).toEqual({
      invalid: true,
      describedBy: true,
      reason: 'Yen has no smaller unit. Enter a whole amount, like ¥2,500.',
    });
  });

  it('has nothing to change in a Group with one currency', () => {
    const html = render('100', {
      currencyChoices: expenseCurrencyChoices({ defaultCurrency: 'INR' }, null, 'INR'),
    });
    expect(attribute(html, currencyButton, 'aria-label')).toBe('Currency, INR, Indian Rupee');
    expect(currencyButton.exec(html)![0]).toMatch(/\sdisabled=""/);
    expect(attribute(html, amountInput, 'aria-label')).toBe('Amount, 100.00 Indian rupees');
  });
});

it('does not display a malformed money prefix as the payer total (#773)', () => {
  const shown = text(render('1,84,250', { isEditMode: true, multiPayerMode: true }));
  expect(shown).toContain('Enter an amount like 1,060.00.');
  expect(shown).not.toContain('Total: ₹1.00 / ₹1.00');
});

// #894: an Expense with one payer row among several read "1 people paid".
describe('who paid, in the summary (#894)', () => {
  it('names one payer, as with a single payer, and counts several', () => {
    const summary = (payers: Array<{ user: string; amount: string }>) =>
      text(render('100', { isEditMode: true, multiPayerMode: true, payers }));
    expect(summary([{ user: SAM, amount: '40' }])).toContain('Sam Chen paid');
    expect(summary([{ user: SAM, amount: '40' }])).not.toMatch(/\d (person|people) paid/);
    expect(
      summary([
        { user: YOU, amount: '40' },
        { user: SAM, amount: '60' },
      ]),
    ).toContain('2 people paid');
  });
});

it('shows the selected payer field even if the remembered payer row differs (#1117 decision 7)', () => {
  expect(text(render('100', { payerId: SAM, payers: [{ user: YOU, amount: '100' }] }))).toContain(
    'Sam Chen paid',
  );
});

it.each([
  ['shares', '1.5', 'Use a whole number of shares.'],
  ['percentage', 'word', 'Use digits and one decimal point, such as 33.5.'],
  ['unequal', 'word', 'Use digits and one decimal point, such as 250.50.'],
] as const)(
  'marks the %s box for %s while typing (#1117 decisions 4–5)',
  (splitMethod, value, words) => {
    expect(
      text(render('100', { splitMethod, splitValues: { [YOU]: value, [SAM]: '1' } })),
    ).toContain(words);
  },
);

it('shows both shares while the payer total is wrong (#1117 decision 8)', () => {
  expect(
    text(render('100', { multiPayerMode: true, payers: [{ user: YOU, amount: '40' }] })).match(
      /₹50\.00/g,
    ),
  ).toHaveLength(2);
});

it('shows the leftover-cent note on the new Expense form (#1117 decision 9)', () => {
  expect(text(render('0.01'))).toContain('The leftover ₹0.01 goes to you so the total is exact.');
});
