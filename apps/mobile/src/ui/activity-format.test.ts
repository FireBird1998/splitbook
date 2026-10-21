import { describe, expect, it } from 'vitest';
import { parseActivityPage, type ActivityEvent } from '../data/activity';
import { mockDeviceLocale } from '../test-utils/device-locale';
import {
  activityDays,
  dayLabel,
  describeActivity,
  describeChanges,
  describeSettlementBatch,
  spokenActivity,
  type ActivityDetail,
  type ActivityLine,
} from './activity-format';

const now = new Date(2026, 8, 30, 12).getTime();
const at = (day: number, hour = 10) => new Date(2026, 8, day, hour).toISOString();
const event = (overrides: Partial<ActivityEvent>): ActivityEvent => ({
  _id: 'd00000000000000000000001',
  group: 'b00000000000000000000001',
  type: 'expense_added',
  actor: { _id: 'a00000000000000000000001', name: 'Priya Shah' },
  createdAt: at(30),
  metadata: {},
  ...overrides,
});

describe('Activity days', () => {
  it('labels today and yesterday, and dates older days day-first on a US phone (#640)', () => {
    mockDeviceLocale('en-US');
    expect(dayLabel(new Date(at(30, 1)), now)).toBe('Today');
    expect(dayLabel(new Date(at(29, 23)), now)).toBe('Yesterday');
    expect(dayLabel(new Date(at(27)), now)).toBe('Sun 27 Sep');
    expect(dayLabel(new Date(2025, 11, 31, 10), now)).toBe('Wed 31 Dec 2025');
  });

  it('keeps newest-first order and starts a new group at each local day', () => {
    const events = [
      event({ _id: '1', createdAt: at(30, 9) }),
      event({ _id: '2', createdAt: at(30, 8) }),
      event({ _id: '3', createdAt: at(29, 20) }),
      event({ _id: '4', createdAt: at(27) }),
    ];
    expect(
      activityDays(events, now).map((day) => [day.label, day.events.map((e) => e._id)]),
    ).toEqual([
      ['Today', ['1', '2']],
      ['Yesterday', ['3']],
      [dayLabel(new Date(at(27)), now), ['4']],
    ]);
  });
});

describe('Expense edits in plain language', () => {
  const members = [
    { id: 'a00000000000000000000001', name: 'Priya Shah' },
    { id: 'a00000000000000000000002', name: 'Sam Chen' },
  ];

  const edit = {
    amount: { old: 899, new: 999 },
    amountMinor: { old: 89900, new: 99900 },
    description: { old: 'Wifi', new: 'Wi-Fi' },
    paidBy: {
      old: [{ user: 'a00000000000000000000001', amount: 899, amountMinor: 89900 }],
      new: [{ user: 'a00000000000000000000001', amount: 999, amountMinor: 99900 }],
    },
    splitBetween: {
      old: [{ user: 'a00000000000000000000002', amount: 899, amountMinor: 89900 }],
      new: [{ user: 'a00000000000000000000009', amount: 999, amountMinor: 99900 }],
    },
    tagId: { old: 'c00000000000000000000001', new: 'c00000000000000000000002' },
    tag: { old: 'Utilities', new: 'Internet' },
  };
  const read = (details: ActivityDetail[]) => details.map((detail) => detail.text);

  it('reads like the Expense history: amounts, names and shares, never references', () => {
    const lines = describeChanges(edit, { currency: 'INR', members });
    // Priya's payment only followed the new amount, so it has no line of its own (#515).
    expect(read(lines)).toEqual([
      'Amount ₹899.00 → ₹999.00',
      'Description “Wifi” → “Wi-Fi”',
      'Former member’s share Not included → ₹999.00',
      'Sam Chen’s share ₹899.00 → Not included',
      'Tag Utilities → Internet',
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/[0-9a-f]{24}/);
  });

  it('sets each amount apart for the money font, but not words such as “Not included”', () => {
    const lines = describeChanges(edit, { currency: 'INR', members });
    expect(
      lines.map((line) => (line.runs ?? []).filter((run) => run.mono).map((run) => run.text)),
    ).toEqual([['₹899.00', '₹999.00'], [], ['₹999.00'], ['₹899.00'], []]);
    expect(lines.every((line) => line.runs?.map((run) => run.text).join('') === line.text)).toBe(
      true,
    );
  });

  it('keeps each amount in the currency it had when the edit changes currency', () => {
    expect(
      read(
        describeChanges(
          { amount: { old: 10, new: 12 }, currency: { old: 'INR', new: 'USD' } },
          { currency: 'INR' },
        ),
      ),
    ).toEqual(['Amount ₹10.00 → $12.00', 'Currency INR → USD']);
  });

  it('names a change it can only report, such as an unknown field', () => {
    expect(
      read(describeChanges({ receipt: { old: null, new: 'x' } }, { currency: 'INR' })),
    ).toEqual(['Other details changed']);
  });
});

describe('Activity headlines', () => {
  const context = { currentUserId: 'a00000000000000000000009', currency: 'INR' };

  it('names the signed-in member "You" and shows the amount', () => {
    const line = describeActivity(
      event({
        actor: { _id: context.currentUserId, name: 'Alex Rao' },
        metadata: { description: 'Weekly groceries', amount: 1249.5, currency: 'INR' },
      }),
      context,
    );
    expect(line).toMatchObject({
      actor: 'You',
      verb: 'added',
      subject: 'Weekly groceries',
      details: [{ text: '₹1,249.50', mono: true }],
    });
  });

  it('summarises an edit by its first change and how many more', () => {
    const line = describeActivity(
      event({
        type: 'expense_updated',
        metadata: {
          description: 'Wi-Fi',
          changes: { amount: { old: 899, new: 999 }, notes: { old: '', new: 'x' } },
        },
      }),
      context,
    );
    expect(line.verb).toBe('edited');
    expect(line.details.map((detail) => detail.text)).toEqual([
      'Amount ₹899.00 → ₹999.00',
      '1 more',
    ]);
    expect(line.details[0].runs?.filter((run) => run.mono).map((run) => run.text)).toEqual([
      '₹899.00',
      '₹999.00',
    ]);
    expect(line.changes).toHaveLength(2);
  });

  it('shows who paid whom for a payment, and a fallback for a former member', () => {
    const line = describeActivity(
      event({
        type: 'settlement_recorded',
        actor: null,
        metadata: {
          amount: 200,
          currency: 'INR',
          paidByName: 'Priya Shah',
          paidToName: 'Sam Chen',
        },
      }),
      context,
    );
    expect(line).toMatchObject({
      actor: 'Former member',
      verb: 'recorded a payment',
      subject: null,
    });
    expect(line.details.map((detail) => detail.text)).toEqual(['Priya Shah → Sam Chen', '₹200.00']);
  });

  it('names the signed-in member "You" in what an edit changed (#434)', () => {
    const namesake = 'a00000000000000000000008';
    const line = describeActivity(
      event({
        type: 'expense_updated',
        metadata: {
          description: 'Dinner',
          changes: {
            paidBy: {
              old: [{ user: context.currentUserId, amount: 1200 }],
              new: [{ user: context.currentUserId, amount: 1500 }],
            },
            splitBetween: {
              old: [
                { user: context.currentUserId, amount: 600 },
                { user: namesake, amount: 600 },
              ],
              new: [
                { user: context.currentUserId, amount: 750 },
                { user: namesake, amount: 750 },
              ],
            },
          },
        },
      }),
      {
        ...context,
        members: [
          { id: context.currentUserId, name: 'Alex Rao' },
          { id: namesake, name: 'Alex Rao' },
        ],
      },
    );
    expect(line.changes.map((change) => change.text)).toEqual([
      'Your payment ₹1,200.00 → ₹1,500.00',
      'Your share ₹600.00 → ₹750.00',
      'Alex Rao’s share ₹600.00 → ₹750.00',
    ]);
  });

  it('names the admin and the Assistant rule they set, as the server sends it (#621)', () => {
    const [changed] = parseActivityPage(
      {
        status: 200,
        data: {
          activities: [
            event({
              type: 'assistant_rule_changed',
              actor: { _id: 'a00000000000000000000003', name: 'Alex Rivera' },
              metadata: { rule: 'not_allowed' } as ActivityEvent['metadata'],
            }),
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
      'b00000000000000000000001',
      1,
    ).events;
    expect(describeActivity(changed, context)).toMatchObject({
      actor: 'Alex Rivera',
      verb: 'set connected assistants to',
      subject: 'Not allowed',
    });
  });

  it('names the signed-in member "You" on either side of a payment, even beside a namesake (#434)', () => {
    const namesake = 'a00000000000000000000008';
    // As the server sends it: the payment's people by reference and by name.
    const payment = (paidBy: string, paidTo: string) =>
      parseActivityPage(
        {
          status: 200,
          data: {
            activities: [
              event({
                type: 'settlement_recorded',
                actor: { _id: paidBy, name: 'Alex Rao' },
                metadata: {
                  amount: 200,
                  currency: 'INR',
                  paidBy,
                  paidTo,
                  paidByName: 'Alex Rao',
                  paidToName: 'Alex Rao',
                } as ActivityEvent['metadata'],
              }),
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          },
        },
        'b00000000000000000000001',
        1,
      ).events[0];
    const read = (line: ActivityLine) => line.details.map((detail) => detail.text);
    expect(read(describeActivity(payment(namesake, context.currentUserId), context))).toEqual([
      'Alex Rao → You',
      '₹200.00',
    ]);
    expect(read(describeActivity(payment(context.currentUserId, namesake), context))).toEqual([
      'You → Alex Rao',
      '₹200.00',
    ]);
  });
});

describe('Group edits in plain language', () => {
  const you = 'a00000000000000000000009';
  const priya = 'a00000000000000000000001';
  const context = {
    currentUserId: you,
    currency: 'INR',
    members: [
      { id: you, name: 'Alex Rao' },
      { id: priya, name: 'Priya Shah' },
    ],
  };
  const edit = (
    changes: Record<string, { old?: unknown; new?: unknown }>,
    actor = you,
    recorded: { groupName?: string; currencies?: string[] } = {},
  ) =>
    describeActivity(
      event({
        type: 'group_updated',
        actor: { _id: actor, name: context.members.find((member) => member.id === actor)?.name },
        metadata: { changes, ...recorded },
      }),
      context,
    );
  const read = (line: ActivityLine) => ({
    headline: spokenActivity(line, '11:05'),
    details: line.details.map((detail) => detail.text),
    changes: line.changes.map((change) => change.text),
  });
  const role = (userId: string, old: string, now: string) => ({
    memberRole: { old: { userId, role: old }, new: { userId, role: now } },
  });

  it('says who was made an admin or a member, by name or as you', () => {
    expect(read(edit(role(priya, 'member', 'admin')))).toEqual({
      headline: 'You made Priya Shah an admin, Member role, 11:05',
      details: ['Member role'],
      changes: ['Priya Shah’s role Member → Group admin'],
    });
    expect(read(edit(role(you, 'admin', 'member'), priya))).toEqual({
      headline: 'Priya Shah made you a member, Member role, 11:05',
      details: ['Member role'],
      changes: ['Your role Group admin → Member'],
    });
    expect(read(edit(role(priya, 'admin', 'member'), priya)).headline).toBe(
      'Priya Shah made themselves a member, Member role, 11:05',
    );
  });

  it('calls someone the Group no longer has a former member, never a reference', () => {
    const line = edit(role('a00000000000000000000004', 'member', 'admin'));
    expect(read(line)).toEqual({
      headline: 'You made a former member an admin, Member role, 11:05',
      details: ['Member role'],
      changes: ['Former member’s role Member → Group admin'],
    });
    expect(JSON.stringify(line)).not.toMatch(/[0-9a-f]{24}/);
  });

  it('names the currency added or removed, and what the list became, as recorded (#721)', () => {
    const recorded = (currencies: string[]) => ({ groupName: 'Lisbon & Tokyo', currencies });
    expect(
      read(
        edit(
          { alternateCurrencies: { old: ['EUR'], new: ['EUR', 'CHF'] } },
          priya,
          recorded(['INR', 'EUR', 'CHF']),
        ),
      ),
    ).toEqual({
      headline:
        'Priya Shah added CHF to the Group’s currencies, Lisbon & Tokyo now uses INR, EUR and CHF, 11:05',
      details: ['Lisbon & Tokyo now uses INR, EUR and CHF'],
      changes: ['Extra currencies EUR → EUR, CHF'],
    });
    expect(
      read(
        edit(
          { alternateCurrencies: { old: ['EUR', 'GBP'], new: ['EUR'] } },
          you,
          recorded(['INR', 'EUR']),
        ),
      ),
    ).toEqual({
      headline: 'You removed GBP from the Group’s currencies, Nothing used it, 11:05',
      details: ['Nothing used it'],
      changes: ['Extra currencies EUR, GBP → EUR'],
    });
    // An older entry recorded without its list says nothing more, added or removed.
    expect(read(edit({ alternateCurrencies: { old: ['EUR'], new: ['EUR', 'CHF'] } }))).toEqual({
      headline: 'You added CHF to the Group’s currencies, 11:05',
      details: [],
      changes: ['Extra currencies EUR → EUR, CHF'],
    });
    expect(read(edit({ alternateCurrencies: { old: ['EUR', 'GBP'], new: ['EUR'] } }))).toEqual({
      headline: 'You removed GBP from the Group’s currencies, 11:05',
      details: [],
      changes: ['Extra currencies EUR, GBP → EUR'],
    });
  });

  it('shows a rename, a currency change and archiving plainly', () => {
    expect(read(edit({ name: { old: 'Maple House', new: 'Maple Flat' } }))).toEqual({
      headline: 'You renamed the Group, “Maple House” → “Maple Flat”, 11:05',
      details: ['“Maple House” → “Maple Flat”'],
      changes: ['Name “Maple House” → “Maple Flat”'],
    });
    expect(read(edit({ defaultCurrency: { old: 'INR', new: 'USD' } }))).toEqual({
      headline: 'You changed the currency, INR → USD, 11:05',
      details: ['INR → USD'],
      changes: ['Currency INR → USD'],
    });
    expect(read(edit({ isArchived: { old: false, new: true } }))).toEqual({
      headline: 'You archived the Group, 11:05',
      details: [],
      changes: ['Status Active → Archived'],
    });
  });

  it('leads with the first change and lists every change for the detail', () => {
    mockDeviceLocale('en-US');
    const line = edit({
      name: { old: 'Maple House', new: 'Maple Flat' },
      description: { old: '', new: 'Flat 302' },
      category: { old: 'home', new: 'trip' },
      startDate: { old: null, new: '2026-10-01T00:00:00.000Z' },
    });
    expect(read(line)).toEqual({
      headline: 'You renamed the Group, “Maple House” → “Maple Flat”, 3 more, 11:05',
      details: ['“Maple House” → “Maple Flat”', '3 more'],
      changes: [
        'Name “Maple House” → “Maple Flat”',
        'Description None → “Flat 302”',
        'Theme Household → Trip',
        'Start date None → 1 Oct 2026',
      ],
    });
  });

  it('keeps today’s wording for a change it doesn’t know, after the ones it does', () => {
    expect(read(edit({ coverImage: { old: null, new: 'x' } }))).toEqual({
      headline: 'You updated the Group details, 11:05',
      details: [],
      changes: ['Other details changed'],
    });
    expect(
      read(edit({ coverImage: { old: null, new: 'x' }, name: { old: 'A', new: 'B' } })).changes,
    ).toEqual(['Name “A” → “B”', 'Other details changed']);
    expect(read(edit({}))).toEqual({
      headline: 'You updated the Group details, 11:05',
      details: [],
      changes: [],
    });
  });
});

// #751: an assistant's credit is its own part of the line, so a row can give it a line of its
// own, cut where the domain stays readable; the screen reader still hears it whole.
describe('an assistant’s credit in an Activity line (#751)', () => {
  const context = { currentUserId: 'a00000000000000000000009', currency: 'INR' };
  const host = 'chatgpt.com.secure-assistant-connector.evil.example.test';

  it('is the line’s credit, not one of its details, and is read aloud whole', () => {
    const line = describeActivity(
      event({
        metadata: {
          description: 'Weekly groceries',
          amount: 1249.5,
          currency: 'INR',
          preparedBy: { kind: 'assistant', name: host },
        },
      }),
      context,
    );
    expect(line.credit).toBe(`prepared by ${host}`);
    expect(line.details.map((detail) => detail.text).join(' ')).not.toContain('prepared by');
    expect(spokenActivity(line, '10:42')).toContain(`prepared by ${host}`);
  });
});

// #728: a Debt paid in another currency, as the board "Activity" shows it, read through the
// Activity page's parse as the server sends it.
describe('a Debt paid in another currency (#728)', () => {
  const alex = 'a00000000000000000000001',
    sam = 'a00000000000000000000002';
  const paid = (metadata: Record<string, unknown> = {}) =>
    parseActivityPage(
      {
        status: 200,
        data: {
          activities: [
            event({
              type: 'settlement_recorded',
              actor: { _id: alex, name: 'Alex Rivera' },
              metadata: {
                settlementId: 'f00000000000000000000001',
                amount: 20,
                amountMinor: 2000,
                currency: 'EUR',
                paidBy: alex,
                paidTo: sam,
                paidByName: 'Alex Rivera',
                paidToName: 'Sam Chen',
                amountPaidMinor: 185000,
                paidCurrency: 'INR',
                appliedRate: '92.5',
                rateKind: 'custom',
                suggestedRate: '92.1',
                rateSource: 'frankfurter',
                rateAsOf: '2026-10-21',
                rateFetchedAt: '2026-10-21T00:30:00.000Z',
                pairDebtBeforeMinor: -2000,
                pairDebtAfterMinor: 0,
                ...metadata,
              } as ActivityEvent['metadata'],
            }),
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
      'b00000000000000000000001',
      1,
    ).events[0];

  it('says who paid whom, both amounts, then the rate beside the suggestion', () => {
    const line = describeActivity(paid(), { currentUserId: alex, currency: 'INR' });
    expect(line).toMatchObject({
      actor: 'You',
      verb: 'paid',
      subject: 'Sam Chen',
      complement: '₹1,850.00 to clear €20.00',
    });
    expect(line.details.map((detail) => detail.text)).toEqual([
      'at ₹92.50 per €, suggested ₹92.10 (21 Oct)',
    ]);
    expect(spokenActivity(line, '10:20')).toBe(
      'You paid Sam Chen ₹1,850.00 to clear €20.00, at ₹92.50 per €, suggested ₹92.10 (21 Oct), 10:20',
    );
  });

  it('names the viewer "you" when they were paid, says when no rate was suggested, and names a second source', () => {
    const entered = describeActivity(
      paid({
        rateKind: 'entered',
        appliedRate: '92.4',
        amountPaidMinor: 184800,
        suggestedRate: undefined,
        rateSource: undefined,
        rateAsOf: undefined,
        rateFetchedAt: undefined,
      }),
      { currentUserId: sam, currency: 'INR' },
    );
    expect(entered).toMatchObject({
      actor: 'Alex Rivera',
      verb: 'paid',
      subject: 'you',
      complement: '₹1,848.00 to clear €20.00',
    });
    expect(entered.details.map((detail) => detail.text)).toEqual([
      'at ₹92.40 per €; no rate suggested',
    ]);
    const mixed = describeActivity(paid({ rateSource: 'mixed' }), {
      currentUserId: alex,
      currency: 'INR',
    });
    expect(mixed.details.map((detail) => detail.text)).toEqual([
      'at ₹92.50 per €, suggested ₹92.10 (21 Oct) · Rates By Exchange Rate API',
    ]);
  });

  it('keeps a payment in its Debt’s own currency as before', () => {
    const line = describeActivity(
      paid({
        amountPaidMinor: undefined,
        paidCurrency: undefined,
        appliedRate: undefined,
        rateKind: undefined,
        suggestedRate: undefined,
        rateSource: undefined,
        rateAsOf: undefined,
        rateFetchedAt: undefined,
        pairDebtBeforeMinor: undefined,
        pairDebtAfterMinor: undefined,
      }),
      { currentUserId: alex, currency: 'INR' },
    );
    expect(line).toMatchObject({ actor: 'You', verb: 'recorded a payment', subject: null });
    expect(line.details.map((detail) => detail.text)).toEqual(['You → Sam Chen', '€20.00']);
  });

  // Stored money outlives today's supported list (#779): one such event must not fail the page.
  describe('in a currency Splitbook no longer supports (#779)', () => {
    const noSuggestion = {
      suggestedRate: undefined,
      rateSource: undefined,
      rateAsOf: undefined,
      rateFetchedAt: undefined,
    };

    it('reads a Debt in it paid in a supported currency', () => {
      const line = describeActivity(
        paid({
          amount: 40,
          amountMinor: 4000,
          currency: 'DEM',
          amountPaidMinor: 2000,
          paidCurrency: 'EUR',
          appliedRate: '0.5',
          rateKind: 'entered',
          ...noSuggestion,
        }),
        { currentUserId: alex, currency: 'INR' },
      );
      expect(line).toMatchObject({ actor: 'You', verb: 'paid', subject: 'Sam Chen' });
      expect(line.complement).toMatch(/^€20\.00 to clear DEM\s40\.00$/);
    });

    it('reads a payment in its own currency', () => {
      const line = describeActivity(
        paid({
          amount: 40,
          amountMinor: 4000,
          currency: 'DEM',
          amountPaidMinor: undefined,
          paidCurrency: undefined,
          appliedRate: undefined,
          rateKind: undefined,
          ...noSuggestion,
          pairDebtBeforeMinor: undefined,
          pairDebtAfterMinor: undefined,
        }),
        { currentUserId: alex, currency: 'INR' },
      );
      expect(line).toMatchObject({ actor: 'You', verb: 'recorded a payment' });
      const [people, amount] = line.details.map((detail) => detail.text);
      expect(people).toBe('You → Sam Chen');
      expect(amount).toMatch(/^DEM\s40\.00$/);
    });

    it('reads an Expense in it', () => {
      const [added] = parseActivityPage(
        {
          status: 200,
          data: {
            activities: [
              event({ metadata: { description: 'Old dinner', amount: 40, currency: 'DEM' } }),
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          },
        },
        'b00000000000000000000001',
        1,
      ).events;
      const line = describeActivity(added!, { currentUserId: alex, currency: 'INR' });
      expect(line).toMatchObject({ verb: 'added', subject: 'Old dinner' });
      expect(line.details.map((detail) => detail.text)).toEqual([
        expect.stringMatching(/^DEM\s40\.00$/),
      ]);
    });
  });
});

// #734: a payment that settled several Debts at once is one Activity row, in the single payment's
// words, read through the Activity page's parse as the server sends it.
describe('a payment that settled several Debts at once (#734)', () => {
  const alex = 'a00000000000000000000001',
    sam = 'a00000000000000000000002';
  const people = { paidBy: alex, paidTo: sam, paidByName: 'Alex Rivera', paidToName: 'Sam Chen' };
  const batch = { batchId: 'f00000000000000000000001', batchSize: 2 };
  const events = parseActivityPage(
    {
      status: 200,
      data: {
        activities: [
          event({
            _id: 'd00000000000000000000011',
            type: 'settlement_recorded',
            actor: { _id: alex, name: 'Alex Rivera' },
            metadata: {
              ...people,
              ...batch,
              settlementId: 'f00000000000000000000001',
              amount: 1480,
              amountMinor: 148000,
              currency: 'INR',
            } as ActivityEvent['metadata'],
          }),
          event({
            _id: 'd00000000000000000000012',
            type: 'settlement_recorded',
            actor: { _id: alex, name: 'Alex Rivera' },
            metadata: {
              ...people,
              ...batch,
              settlementId: 'f00000000000000000000002',
              amount: 20,
              amountMinor: 2000,
              currency: 'EUR',
              amountPaidMinor: 184200,
              paidCurrency: 'INR',
              appliedRate: '92.1',
              rateKind: 'suggested',
              suggestedRate: '92.1',
              rateSource: 'frankfurter',
              rateAsOf: '2026-10-20',
              rateFetchedAt: '2026-10-21T00:30:00.000Z',
            } as ActivityEvent['metadata'],
          }),
        ],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      },
    },
    'b00000000000000000000001',
    1,
  ).events;

  it('keeps each event’s batch reference through the page’s parse', () => {
    expect(events.map(({ metadata }) => [metadata.batchId, metadata.batchSize])).toEqual([
      ['f00000000000000000000001', 2],
      ['f00000000000000000000001', 2],
    ]);
  });

  it('says what was paid in all, each Debt cleared, and each one’s rate', () => {
    const line = describeSettlementBatch(events, 2, { currentUserId: alex, currency: 'INR' });
    expect(line).toMatchObject({
      actor: 'You',
      verb: 'paid',
      subject: 'Sam Chen',
      complement: '₹3,322.00 to clear ₹1,480.00 and €20.00',
    });
    expect(line.details.map((detail) => detail.text)).toEqual([
      '₹1,480.00, same currency, no rate',
      '€20.00 at ₹92.10 per €, suggested ₹92.10 (20 Oct)',
    ]);
    expect(spokenActivity(line, '10:20')).toBe(
      'You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00, ₹1,480.00, same currency, no rate, €20.00 at ₹92.10 per €, suggested ₹92.10 (20 Oct), 10:20',
    );
  });

  it('says where the rest of a payment a page boundary split is', () => {
    const line = describeSettlementBatch(events.slice(0, 1), 2, {
      currentUserId: alex,
      currency: 'INR',
    });
    expect(line.complement).toBe('to clear ₹1,480.00 and 1 more Debt');
    expect(line.details.map((detail) => detail.text)).toEqual([
      '₹1,480.00, same currency, no rate',
      'The rest of this payment is in older Activity.',
    ]);
  });
});
