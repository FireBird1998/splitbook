import { describe, expect, it } from 'vitest';
import { toDateParam } from './date';
import { ExpenseDraft } from './expense-draft';
import {
  QUICK_ADD_DESCRIPTION_MAX,
  quickAddDraftValues,
  quickAddSplitMembers,
  readQuickAdd,
  suggestQuickAddTag,
  type QuickAddContext,
  type QuickAddMember,
  type QuickAddTag,
} from './quick-add';

/*
 * #320: Quick add reads "Dinner 2400 paid by me" into an Expense's parts. Days are passed in as
 * `yyyy-MM-dd` and compared as strings, so every case holds in any zone the suite runs in
 * (UTC, Pacific/Pago_Pago, Pacific/Kiritimati, Pacific/Tongatapu). Each "today" here is built
 * with the app's own formatter from a local noon, never written as a local-time date.
 */

const ALEX: QuickAddMember = { id: 'a00000000000000000000001', name: 'Alex Rivera' };
const SAM: QuickAddMember = { id: 'a00000000000000000000002', name: 'Sam Chen' };
const PRIYA: QuickAddMember = { id: 'a00000000000000000000003', name: 'Priya Shah' };
const SAM_LEE: QuickAddMember = { id: 'a00000000000000000000004', name: 'Sam Lee' };
const MARY: QuickAddMember = { id: 'a00000000000000000000005', name: 'Mary Ann Lee' };
const JOSE: QuickAddMember = { id: 'a00000000000000000000006', name: 'José García' };
const PRIYA_HI: QuickAddMember = { id: 'a00000000000000000000007', name: 'प्रिया' };

/** A calendar day, through the app's own formatter: local noon is that day in every zone. */
const day = (year: number, month: number, date: number) =>
  toDateParam(new Date(year, month - 1, date, 12));

const TODAY = day(2026, 10, 7);

function context(overrides: Partial<QuickAddContext> = {}): QuickAddContext {
  return {
    currency: 'INR',
    today: TODAY,
    viewerId: ALEX.id,
    members: [ALEX, SAM, PRIYA],
    ...overrides,
  };
}

const read = (text: string, overrides: Partial<QuickAddContext> = {}) =>
  readQuickAdd(text, context(overrides));

const codes = (text: string, overrides: Partial<QuickAddContext> = {}) =>
  read(text, overrides).problems.map((problem) => problem.code);

describe('readQuickAdd: the design canvas’s line', () => {
  it('reads "Dinner 2400 paid by me" into every part, with nothing left to fix', () => {
    expect(read('Dinner 2400 paid by me')).toEqual({
      description: 'Dinner',
      amountMinor: 240000,
      amountText: '2400',
      payer: { memberId: ALEX.id, said: 'me', candidates: [] },
      split: { mode: 'all', memberIds: [] },
      date: TODAY,
      dateSaid: 'default',
      problems: [],
    });
  });

  it('defaults to the member typing, everyone equally and today', () => {
    const line = read('Dinner 2400');
    expect(line.payer).toEqual({ memberId: ALEX.id, said: null, candidates: [] });
    expect(quickAddSplitMembers(line, line.payer.memberId, context().members)).toEqual([
      ALEX.id,
      SAM.id,
      PRIYA.id,
    ]);
    expect(line.date).toBe(TODAY);
    expect(line.dateSaid).toBe('default');
  });

  it('dates an unsaid day today in the viewer’s own zone, as the full form does', () => {
    const today = toDateParam(new Date());
    expect(read('Dinner 2400', { today }).date).toBe(today);
  });
});

describe('readQuickAdd: many ways to say the same Expense', () => {
  it.each([
    'Dinner 2400',
    '2400 dinner',
    'dinner for 2400',
    '2400 for dinner',
    'Dinner ₹2400',
    'Dinner ₹ 2400',
    'Dinner ₹2,400',
    'Dinner Rs. 2400',
    'Dinner Rs 2400',
    'Dinner rs.2400',
    'Dinner 2400rs',
    'Dinner INR 2400',
    'Dinner 2400 INR',
    'Dinner 2400/-',
    'Dinner 2,400.00',
    'Dinner, 2400, paid by me.',
    'Dinner - 2400',
    'I paid 2400 for dinner',
    'dinner 2400 paid by myself',
    'paid by me: dinner 2400',
    'Dinner 2400 today',
    'today dinner 2400 paid by me',
    '  Dinner   2400  ',
  ])('“%s” is Dinner, ₹2,400.00, paid by Alex', (text) => {
    const line = read(text);
    expect(line.description).toBe('Dinner');
    expect(line.amountMinor).toBe(240000);
    expect(line.payer.memberId).toBe(ALEX.id);
    expect(line.date).toBe(TODAY);
    expect(line.problems).toEqual([]);
  });

  it.each([
    ['Dinner 2400 paid by Sam', SAM.id, 'Sam'],
    ['Dinner 2400 paid by sam chen', SAM.id, 'sam chen'],
    ['Dinner 2400 paid by Chen', SAM.id, 'Chen'],
    ['Dinner 2400 paid by pri', PRIYA.id, 'pri'],
    ['Sam paid 2400 for dinner', SAM.id, 'Sam'],
    ['Sam Chen paid 2400 for dinner', SAM.id, 'Sam Chen'],
    ['Dinner 2400 paid by Alex', ALEX.id, 'Alex'],
    ['Dinner 2400 PAID BY PRIYA', PRIYA.id, 'PRIYA'],
  ])('“%s” names who paid', (text, payer, said) => {
    const line = read(text);
    expect(line.payer).toEqual({ memberId: payer, said, candidates: [] });
    expect(line.description).toBe('Dinner');
    expect(line.amountMinor).toBe(240000);
    expect(line.problems).toEqual([]);
  });
});

describe('readQuickAdd: amounts', () => {
  it('reads exact minor units, never through floating point', () => {
    expect(read('Coffee 120.50').amountMinor).toBe(12050);
    expect(read('Coffee 0.1').amountMinor).toBe(10);
    expect(read('Coffee 1234567.89').amountMinor).toBe(123456789);
    expect(read('Rent 1,00,000').amountMinor).toBe(10000000);
    expect(read('Rent 2,400.50').amountMinor).toBe(240050);
  });

  it('checks decimals against the Group’s currency and rounds nothing', () => {
    const inr = read('Coffee 120.505');
    expect(inr.amountMinor).toBeNull();
    expect(inr.amountText).toBe('120.505');
    expect(inr.problems).toEqual([
      {
        field: 'amount',
        code: 'amount-decimals',
        kind: 'invalid',
        message: 'INR amounts have at most 2 decimal places. Nothing is rounded for you.',
      },
    ]);

    expect(read('Sushi 3000', { currency: 'JPY' }).amountMinor).toBe(3000);
    expect(read('Sushi 3000.5', { currency: 'JPY' }).problems[0]).toMatchObject({
      code: 'amount-decimals',
      message: 'JPY amounts have no decimal places. Nothing is rounded for you.',
    });
    expect(read('Bibimbap 12000', { currency: 'KRW' }).amountMinor).toBe(12000);
    expect(read('Lunch 12.34', { currency: 'EUR' }).amountMinor).toBe(1234);
    expect(codes('Lunch 12.345', { currency: 'EUR' })).toEqual(['amount-decimals']);
  });

  it('refuses zero and a minus sign', () => {
    for (const text of ['Dinner 0', 'Dinner 0.00', 'Dinner ₹0'])
      expect(read(text).problems[0]).toMatchObject({
        code: 'amount-zero',
        message: 'Enter an amount above zero.',
      });
    expect(read('Refund -200').problems[0]).toMatchObject({
      code: 'amount-negative',
      kind: 'invalid',
    });
    expect(read('Refund -200').amountMinor).toBeNull();
  });

  it('refuses more than the largest Expense the ledger takes, and takes exactly that', () => {
    expect(read('Flat 10000000').amountMinor).toBe(1_000_000_000);
    expect(read('Flat 10,000,000.00').amountMinor).toBe(1_000_000_000);
    expect(read('Flat 10000000.01').problems[0]).toEqual({
      field: 'amount',
      code: 'amount-too-large',
      kind: 'invalid',
      message: 'One Expense can be at most ₹10,000,000.00.',
    });
    expect(read('Car 10000000', { currency: 'JPY' }).amountMinor).toBe(10_000_000);
    expect(read('Car 10000001', { currency: 'JPY' }).problems[0]).toMatchObject({
      code: 'amount-too-large',
      message: 'One Expense can be at most ¥10,000,000.',
    });
    expect(codes('Moon 99999999999999999999999')).toEqual(['amount-too-large']);
  });

  it('says when no amount was typed yet', () => {
    expect(read('Dinner').amountMinor).toBeNull();
    expect(read('Dinner').amountText).toBeNull();
    expect(read('Dinner').problems).toEqual([
      {
        field: 'amount',
        code: 'amount-missing',
        kind: 'needed',
        message: 'Add an amount, like 2400.',
      },
    ]);
  });

  it('refuses a comma as a decimal point rather than guess', () => {
    expect(codes('Lunch 12,50', { currency: 'EUR' })).toEqual(['amount-format']);
    expect(codes('Lunch 1,2345')).toEqual(['amount-format']);
  });

  it('refuses another currency, by its symbol or its code in capitals', () => {
    for (const text of ['Taxi $20', 'Taxi USD 20', 'Taxi 20 EUR', 'Taxi €20', 'Taxi C$20']) {
      const line = read(text);
      expect(line.amountMinor).toBeNull();
      expect(line.problems[0]).toEqual({
        field: 'amount',
        code: 'amount-currency',
        kind: 'invalid',
        message: 'This Group records INR, so write the amount in INR, like ₹2400.',
      });
    }
    // Words that happen to be currency codes, written as words, are words.
    expect(read('Back rub 500')).toMatchObject({ description: 'Back rub', amountMinor: 50000 });
    // A Group's own dollar: "$" in Canadian dollars.
    expect(read('Taxi $20', { currency: 'CAD' }).amountMinor).toBe(2000);
    expect(read('Taxi C$20', { currency: 'CAD' }).amountMinor).toBe(2000);
    expect(read('Ramen ¥900', { currency: 'JPY' }).amountMinor).toBe(900);
  });

  it('takes the marked number, or else the largest, and leaves the rest in the description', () => {
    expect(read('Dinner for 4 2400')).toMatchObject({
      description: 'Dinner for 4',
      amountMinor: 240000,
    });
    expect(read('2 coffees 300')).toMatchObject({ description: '2 coffees', amountMinor: 30000 });
    expect(read('Taxi 300 to terminal 2')).toMatchObject({
      description: 'Taxi to terminal 2',
      amountMinor: 30000,
    });
    expect(read('Dinner for 4000 people ₹2400')).toMatchObject({
      description: 'Dinner for 4000 people',
      amountMinor: 240000,
    });
    expect(codes('Dinner ₹200 ₹300')).toEqual(['amount-several']);
  });

  it('reads numbers joined to words as words', () => {
    expect(read('Flight 6E2341 4500')).toMatchObject({
      description: 'Flight 6E2341',
      amountMinor: 450000,
    });
    expect(read('10kg rice 600')).toMatchObject({ description: '10kg rice', amountMinor: 60000 });
    expect(read('Dinner 2nd floor 700')).toMatchObject({
      description: 'Dinner 2nd floor',
      amountMinor: 70000,
    });
  });
});

describe('readQuickAdd: who paid', () => {
  it('asks, rather than guesses, when a name fits more than one member', () => {
    const members = [ALEX, SAM, SAM_LEE, PRIYA];
    const line = read('Dinner 2400 paid by Sam', { members });
    expect(line.payer).toEqual({ memberId: null, said: 'Sam', candidates: [SAM.id, SAM_LEE.id] });
    expect(line.problems).toEqual([
      {
        field: 'payer',
        code: 'payer-ambiguous',
        kind: 'invalid',
        message: 'More than one member is called “Sam”: Sam Chen or Sam Lee? Pick who paid.',
      },
    ]);
    expect(line.description).toBe('Dinner');
    expect(read('Dinner 2400 paid by Sam Lee', { members }).payer.memberId).toBe(SAM_LEE.id);
    expect(read('Dinner 2400 paid by lee', { members }).payer.memberId).toBe(SAM_LEE.id);
    expect(read('Sam paid 2400 for dinner', { members }).payer.candidates).toEqual([
      SAM.id,
      SAM_LEE.id,
    ]);
  });

  it('prefers a member’s whole name to part of another’s', () => {
    const justSam = { id: 'a00000000000000000000009', name: 'Sam' };
    const members = [ALEX, SAM, justSam];
    expect(read('Dinner 2400 paid by Sam', { members }).payer.memberId).toBe(justSam.id);
    expect(read('Dinner 2400 paid by Sam Chen', { members }).payer.memberId).toBe(SAM.id);
  });

  it('reads names with spaces, accents and other scripts', () => {
    const members = [ALEX, MARY, JOSE, PRIYA_HI];
    expect(read('Dinner 2400 paid by Mary Ann Lee', { members })).toMatchObject({
      description: 'Dinner',
      payer: { memberId: MARY.id, said: 'Mary Ann Lee' },
    });
    expect(read('Dinner 2400 paid by mary ann', { members })).toMatchObject({
      description: 'Dinner',
      payer: { memberId: MARY.id },
    });
    expect(read('Dinner 2400 paid by Ann Lee', { members }).payer.memberId).toBe(MARY.id);
    expect(read('Tapas 2400 paid by jose', { members }).payer.memberId).toBe(JOSE.id);
    expect(read('Tapas 2400 paid by GARCÍA', { members }).payer.memberId).toBe(JOSE.id);
    expect(read('चाय 40 paid by प्रिया', { members })).toMatchObject({
      description: 'चाय',
      amountMinor: 4000,
      payer: { memberId: PRIYA_HI.id },
      problems: [],
    });
  });

  it('matches current members only', () => {
    const line = read('Dinner 2400 paid by Bob');
    expect(line.payer).toEqual({ memberId: null, said: 'Bob', candidates: [] });
    expect(line.problems).toEqual([
      {
        field: 'payer',
        code: 'payer-unknown',
        kind: 'invalid',
        message: 'No current member is called “Bob”. Pick who paid.',
      },
    ]);
    expect(line.description).toBe('Dinner');
  });

  it('waits for a name after "paid by"', () => {
    expect(read('Dinner 2400 paid by').problems).toEqual([
      {
        field: 'payer',
        code: 'payer-missing',
        kind: 'needed',
        message: 'Who paid? Type a member’s name after “paid by”.',
      },
    ]);
  });

  it('leaves several payers to the full form', () => {
    for (const text of [
      'Dinner 2400 paid by Sam and Priya',
      'Dinner 2400 paid by Sam, Priya',
      'Sam and Priya paid 2400 for dinner',
    ]) {
      const line = read(text);
      expect(line.payer.memberId).toBeNull();
      expect(line.problems.map((problem) => problem.code)).toEqual(['payer-several']);
      expect(line.description).toBe('Dinner');
    }
  });

  it('leaves "paid" without a payer out of the description', () => {
    expect(read('Dinner 2400 paid')).toMatchObject({
      description: 'Dinner',
      payer: { memberId: ALEX.id },
    });
  });
});

describe('readQuickAdd: the split', () => {
  const members = context().members;

  it('splits "with" the payer and those named, and "between" exactly those named', () => {
    const withSam = read('Dinner 2400 split with Sam');
    expect(withSam.split).toEqual({ mode: 'with', memberIds: [SAM.id] });
    expect(withSam.description).toBe('Dinner');
    expect(quickAddSplitMembers(withSam, ALEX.id, members)).toEqual([ALEX.id, SAM.id]);

    const between = read('Cab 600 split between Priya and Sam');
    expect(between.split).toEqual({ mode: 'between', memberIds: [SAM.id, PRIYA.id] });
    expect(quickAddSplitMembers(between, ALEX.id, members)).toEqual([SAM.id, PRIYA.id]);

    expect(read('Cab 600 split among Sam, Priya').split).toEqual({
      mode: 'between',
      memberIds: [SAM.id, PRIYA.id],
    });
    expect(read('Cab 600 split equally between me & Priya').split).toEqual({
      mode: 'between',
      memberIds: [ALEX.id, PRIYA.id],
    });
  });

  it('adds the payer to a "with" split, whoever paid', () => {
    const line = read('Dinner 2400 paid by Sam split with Priya');
    expect(line.payer.memberId).toBe(SAM.id);
    expect(quickAddSplitMembers(line, SAM.id, members)).toEqual([SAM.id, PRIYA.id]);
  });

  it('ends the list at the first word that is not a member', () => {
    expect(read('Dinner 2400 split with Sam and drinks')).toMatchObject({
      description: 'Dinner and drinks',
      split: { mode: 'with', memberIds: [SAM.id] },
      problems: [],
    });
  });

  it('reads "split" and "split equally" alone as the default', () => {
    expect(read('Dinner 2400 split equally')).toMatchObject({
      description: 'Dinner',
      split: { mode: 'all', memberIds: [] },
    });
  });

  it('refuses a name that fits nobody or several, and waits for one', () => {
    expect(read('Dinner 2400 split with Bob').problems).toEqual([
      {
        field: 'split',
        code: 'split-unknown',
        kind: 'invalid',
        message:
          'No current member is called “Bob”. Fix the name, or change the split in More options.',
      },
    ]);
    expect(
      read('Dinner 2400 split with Sam', { members: [ALEX, SAM, SAM_LEE] }).problems[0],
    ).toMatchObject({
      code: 'split-ambiguous',
      message:
        'More than one member is called “Sam”: Sam Chen and Sam Lee. Type the full name, or change the split in More options.',
    });
    expect(codes('Dinner 2400 split with')).toEqual(['split-missing']);
  });
});

describe('readQuickAdd: dates', () => {
  it('reads today and yesterday, across months, leap days and years', () => {
    expect(read('Dinner 2400 today')).toMatchObject({ date: TODAY, dateSaid: 'today' });
    expect(read('Dinner 2400 yesterday')).toMatchObject({
      date: day(2026, 10, 6),
      dateSaid: 'yesterday',
      description: 'Dinner',
    });
    expect(read('Dinner 2400 yesterday', { today: day(2026, 3, 1) }).date).toBe(day(2026, 2, 28));
    expect(read('Dinner 2400 yesterday', { today: day(2028, 3, 1) }).date).toBe(day(2028, 2, 29));
    expect(read('Dinner 2400 yesterday', { today: day(2027, 1, 1) }).date).toBe(day(2026, 12, 31));
  });

  it.each([
    ['Dinner 2400 on 5 Oct', day(2026, 10, 5)],
    ['Dinner 2400 Oct 5', day(2026, 10, 5)],
    ['Dinner 2400 5th October 2026', day(2026, 10, 5)],
    ['Dinner 2400 October 5, 2025', day(2025, 10, 5)],
    ['Dinner 2400 Sept 30', day(2026, 9, 30)],
    ['Dinner 2400 on 2026-10-05', day(2026, 10, 5)],
    ['5 Oct Dinner 2400', day(2026, 10, 5)],
  ])('“%s” is dated %s', (text, date) => {
    expect(read(text)).toMatchObject({
      description: 'Dinner',
      amountMinor: 240000,
      date,
      dateSaid: 'date',
      problems: [],
    });
  });

  it('gives a date without a year the year nearest today', () => {
    expect(read('Party 900 28 Dec', { today: day(2027, 1, 2) }).date).toBe(day(2026, 12, 28));
    expect(read('Party 900 2 Jan', { today: day(2026, 12, 30) }).date).toBe(day(2027, 1, 2));
    expect(read('Party 900 12 Oct').date).toBe(day(2026, 10, 12));
  });

  it('refuses a day the calendar doesn’t have', () => {
    expect(read('Dinner 2400 31 Feb').problems).toEqual([
      {
        field: 'date',
        code: 'date-invalid',
        kind: 'invalid',
        message: 'There’s no 31 February.',
      },
    ]);
    expect(read('Dinner 2400 29 Feb 2026').problems[0].message).toBe(
      'There’s no 29 February 2026.',
    );
    expect(read('Dinner 2400 29 Feb 2028', { today: day(2028, 3, 1) }).date).toBe(day(2028, 2, 29));
    expect(codes('Dinner 2400 2026-02-31')).toEqual(['date-invalid']);
  });

  it('reads a year only near today, so "5 Oct 2400" keeps its amount', () => {
    expect(read('Dinner 5 Oct 2400')).toMatchObject({
      date: day(2026, 10, 5),
      amountMinor: 240000,
    });
  });

  it('leaves weekday names and look-alikes in the description', () => {
    expect(read('Friday drinks 300')).toMatchObject({
      description: 'Friday drinks',
      dateSaid: 'default',
    });
    expect(read("Today's special 300")).toMatchObject({
      description: "Today's special",
      dateSaid: 'default',
    });
    expect(read('May fair 300')).toMatchObject({ description: 'May fair', dateSaid: 'default' });
    expect(read('Dinner ₹5 Oct')).toMatchObject({ description: 'Dinner Oct', amountMinor: 500 });
  });
});

describe('readQuickAdd: descriptions', () => {
  it('keeps Unicode descriptions as typed', () => {
    expect(read('寿司 3000', { currency: 'JPY' })).toMatchObject({
      description: '寿司',
      amountMinor: 3000,
      problems: [],
    });
    expect(read('Café crème 4.50', { currency: 'EUR' })).toMatchObject({
      description: 'Café crème',
      amountMinor: 450,
    });
    expect(read('🍕 pizza night 900').description).toBe('🍕 pizza night');
    expect(read('ägypten trip 900').description).toBe('Ägypten trip');
    expect(read('मसाला चाय 40').description).toBe('मसाला चाय');
  });

  it('capitalises a lower-case first word and keeps anyone’s own capitals', () => {
    expect(read('dinner at anjuna 2400').description).toBe('Dinner at anjuna');
    expect(read('iPhone case 2000').description).toBe('iPhone case');
    expect(read('DMart run 2000').description).toBe('DMart run');
  });

  it('says what is still needed, errors before gaps', () => {
    expect(read('').problems.map(({ code }) => code)).toEqual([
      'amount-missing',
      'description-missing',
    ]);
    expect(codes('2400')).toEqual(['description-missing']);
    expect(read('2400').problems[0].message).toBe('Add what it was for, like Dinner.');
    expect(codes('120.505')).toEqual(['amount-decimals', 'description-missing']);
    expect(codes('Dinner paid by Bob 31 Feb')).toEqual([
      'payer-unknown',
      'date-invalid',
      'amount-missing',
    ]);
  });

  it('refuses a description longer than the ledger takes', () => {
    const long = 'a'.repeat(QUICK_ADD_DESCRIPTION_MAX + 1);
    expect(codes(`${long} 300`)).toEqual(['description-too-long']);
    expect(codes(`${'a'.repeat(QUICK_ADD_DESCRIPTION_MAX)} 300`)).toEqual([]);
  });

  it('reads the same line the same way in any zone', () => {
    // Nothing above reads the clock or the zone: the same line and day give the same parts.
    expect(read('Dinner 2400 yesterday paid by Sam split with Priya')).toEqual(
      read('Dinner 2400 yesterday paid by Sam split with Priya'),
    );
    expect(() => read('Dinner', { today: '2026-13-01' })).toThrow();
  });
});

describe('suggestQuickAddTag', () => {
  const tag = (id: number, name: string, extra: Partial<QuickAddTag> = {}): QuickAddTag => ({
    id: `d0000000000000000000000${id}`,
    name,
    isArchived: false,
    isDeleted: false,
    ...extra,
  });
  const HOME = [
    tag(1, 'General'),
    tag(2, 'Rent'),
    tag(3, 'Utilities'),
    tag(4, 'Groceries'),
    tag(5, 'Internet'),
    tag(6, 'Household'),
  ];
  const TRIP = [
    tag(1, 'General'),
    tag(2, 'Food'),
    tag(3, 'Transport'),
    tag(4, 'Stay'),
    tag(5, 'Activities'),
  ];

  it('suggests a Tag the description names, in either number', () => {
    expect(suggestQuickAddTag('Weekly groceries', HOME)).toEqual({
      tagId: HOME[3].id,
      name: 'Groceries',
      reason: 'named',
    });
    expect(suggestQuickAddTag('Grocery run', HOME)?.name).toBe('Groceries');
    expect(suggestQuickAddTag('October rent', HOME)?.name).toBe('Rent');
    expect(suggestQuickAddTag('Rent and internet', HOME)?.name).toBe('Rent');
  });

  it('suggests the Group’s most-used Tag for Expenses with a word in common', () => {
    const history = [
      { description: 'Cook (September)', tagId: HOME[5].id },
      { description: 'Cook (August)', tagId: HOME[0].id },
      { description: 'Cook (July)', tagId: HOME[5].id },
      { description: 'Plumber', tagId: HOME[2].id },
    ];
    expect(suggestQuickAddTag('Cook October', HOME, history)).toEqual({
      tagId: HOME[5].id,
      name: 'Household',
      reason: 'history',
    });
    // A tie goes to the Tag used most recently (history is newest first).
    expect(
      suggestQuickAddTag('Cook', HOME, [
        { description: 'Cook', tagId: HOME[0].id },
        { description: 'Cook', tagId: HOME[5].id },
      ])?.name,
    ).toBe('General');
    // Short and common words don't make Expenses alike.
    expect(
      suggestQuickAddTag('The cab', TRIP, [{ description: 'The villa', tagId: TRIP[3].id }])?.name,
    ).toBe('Transport');
  });

  it('falls back to a common word, choosing whichever Tag the Group has', () => {
    expect(suggestQuickAddTag('Dinner', TRIP)).toEqual({
      tagId: TRIP[1].id,
      name: 'Food',
      reason: 'keyword',
    });
    expect(suggestQuickAddTag('Dinner', [tag(1, 'General'), tag(2, 'Dining')])?.name).toBe(
      'Dining',
    );
    expect(suggestQuickAddTag('Uber to the airport', TRIP)?.name).toBe('Transport');
    expect(suggestQuickAddTag('Wi-Fi', HOME)?.name).toBe('Internet');
    expect(suggestQuickAddTag('Electricity bill', HOME)?.name).toBe('Utilities');
    expect(suggestQuickAddTag('Beachside villa', TRIP)?.name).toBe('Stay');
  });

  it('suggests nothing when nothing fits, so the member picks', () => {
    expect(suggestQuickAddTag('Dinner', HOME)).toBeNull();
    expect(suggestQuickAddTag('Mystery box', TRIP)).toBeNull();
    expect(suggestQuickAddTag('मसाला चाय', TRIP)).toBeNull();
    expect(suggestQuickAddTag('', TRIP)).toBeNull();
    expect(suggestQuickAddTag('Dinner', [])).toBeNull();
  });

  it('never suggests an archived or deleted Tag', () => {
    const tags = [tag(1, 'General'), tag(2, 'Food', { isArchived: true }), tag(3, 'Dining')];
    expect(suggestQuickAddTag('Food court dinner', tags)).toMatchObject({
      name: 'Dining',
      reason: 'keyword',
    });
    expect(suggestQuickAddTag('Dinner', [tag(2, 'Food', { isDeleted: true })])).toBeNull();
    expect(
      suggestQuickAddTag(
        'Cook',
        [tag(1, 'General'), tag(6, 'Household', { isArchived: true })],
        [{ description: 'Cook', tagId: tag(6, 'Household').id }],
      ),
    ).toBeNull();
  });
});

describe('quickAddDraftValues: the full form’s request', () => {
  const ctx = context();
  const FOOD = 'd00000000000000000000002';

  it('builds exactly the body the full form sends', () => {
    const line = read('Dinner 2400 paid by me');
    const values = quickAddDraftValues(line, { payerId: line.payer.memberId, tagId: FOOD }, ctx);
    const draft = ExpenseDraft.open({
      groupId: 'c00000000000000000000001',
      accountId: ALEX.id,
      memberIds: ctx.members.map(({ id }) => id),
      currency: 'INR',
      defaultTag: '',
      date: TODAY,
    }).edit(values);
    const { submission } = draft.prepare([FOOD], 'key-1');
    expect(submission).toBeDefined();
    expect(JSON.parse(submission!.body)).toEqual({
      description: 'Dinner',
      moneyVersion: 1,
      currency: 'INR',
      amount: 2400,
      amountMinor: 240000,
      paidBy: [{ user: ALEX.id, amount: 2400, amountMinor: 240000 }],
      splitBetween: [
        { user: ALEX.id, amount: 800, amountMinor: 80000 },
        { user: SAM.id, amount: 800, amountMinor: 80000 },
        { user: PRIYA.id, amount: 800, amountMinor: 80000 },
      ],
      category: 'other',
      date: TODAY,
      splitMethod: 'equal',
      tagId: FOOD,
      notes: '',
    });
    expect(submission!.key).toBe('key-1');
  });

  it('splits an uneven amount by the shared largest-remainder rule', () => {
    const line = read('Cab 100 split between Sam and Priya and me');
    const values = quickAddDraftValues(line, { payerId: SAM.id, tagId: FOOD }, ctx);
    const draft = ExpenseDraft.open({
      groupId: 'c00000000000000000000001',
      accountId: ALEX.id,
      memberIds: ctx.members.map(({ id }) => id),
      currency: 'INR',
      defaultTag: '',
      date: TODAY,
    }).edit(values);
    const body = JSON.parse(draft.prepare([FOOD], 'key-2').submission!.body);
    expect(body.paidBy).toEqual([{ user: SAM.id, amount: 100, amountMinor: 10000 }]);
    expect(body.splitBetween.map((row: { amountMinor: number }) => row.amountMinor).sort()).toEqual(
      [3333, 3333, 3334],
    );
  });

  it('keeps a refused amount as typed, and the viewer as payer when nobody is chosen', () => {
    const line = read('Dinner 2,400.505 paid by Bob');
    expect(quickAddDraftValues(line, { payerId: null, tagId: '' }, ctx)).toMatchObject({
      description: 'Dinner',
      amount: '2400.505',
      payers: [{ user: ALEX.id, amount: '' }],
      selectedMembers: [ALEX.id, SAM.id, PRIYA.id],
      tag: '',
      date: TODAY,
    });
    expect(quickAddDraftValues(read('Dinner'), { payerId: null, tagId: '' }, ctx).amount).toBe('');
  });

  it('leaves the Category to the form’s own default', () => {
    expect(
      quickAddDraftValues(read('Dinner 2400'), { payerId: null, tagId: FOOD }, ctx),
    ).not.toHaveProperty('category');
  });
});
