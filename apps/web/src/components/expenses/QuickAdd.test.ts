import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { toDateParam } from '@splitbook/shared/date';
import type { GroupRead } from '@splitbook/shared/group-read';
import {
  readQuickAdd,
  suggestQuickAddTag,
  type QuickAddContext,
  type QuickAddMember,
} from '@splitbook/shared/quick-add';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import QuickAddExpense, {
  QUICK_ADD_NOTE,
  QUICK_ADD_PLACEHOLDER,
  QUICK_ADD_UNCONFIRMED,
  QuickAddView,
  type QuickAddViewProps,
} from './QuickAddExpense';
import { TAG_NEEDED, quickAddDateLabel, quickAddModel } from './quick-add-view';

/*
 * #320: Quick add as the server renders it: the field, the chips for what was read, the line
 * under them, the Tag-needed gate, refused amounts, and an unconfirmed save. The state is the
 * real reading of a typed line; only the clicks are left out.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/groups/c00000000000000000000001/expenses',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const ALEX: QuickAddMember = { id: 'a00000000000000000000001', name: 'Alex Rivera' };
const SAM: QuickAddMember = { id: 'a00000000000000000000002', name: 'Sam Chen' };
const PRIYA: QuickAddMember = { id: 'a00000000000000000000003', name: 'Priya Shah' };
const MEMBERS = [ALEX, SAM, PRIYA];
const TRIP_TAGS = [
  { id: 'd00000000000000000000001', label: 'General' },
  { id: 'd00000000000000000000002', label: 'Food' },
  { id: 'd00000000000000000000003', label: 'Transport' },
];
const HOME_TAGS = [
  { id: 'd00000000000000000000011', label: 'General' },
  { id: 'd00000000000000000000012', label: 'Groceries' },
  { id: 'd00000000000000000000013', label: 'Utilities' },
];

/** Today, through the app's own formatter, so the labels hold in any zone. */
const TODAY = toDateParam(new Date());
const context: QuickAddContext = {
  currency: 'INR',
  today: TODAY,
  viewerId: ALEX.id,
  members: MEMBERS,
};

/** The view for a typed line, with the Tag suggested from `tags` as the field suggests it. */
function view(
  typed: string,
  {
    tags = TRIP_TAGS,
    members = MEMBERS,
    payerId,
    ...props
  }: Partial<QuickAddViewProps> & {
    tags?: typeof TRIP_TAGS;
    members?: QuickAddMember[];
    payerId?: string | null;
  } = {},
  mode: 'light' | 'dark' = 'light',
) {
  const read = readQuickAdd(typed, { ...context, members });
  const suggestion = suggestQuickAddTag(
    read.description,
    tags.map(({ id, label }) => ({ id, name: label })),
  );
  const payer = payerId === undefined ? read.payer.memberId : payerId;
  const model = quickAddModel({
    read,
    today: TODAY,
    currency: 'INR',
    viewerId: ALEX.id,
    members,
    payerId: payer,
    problems: read.problems,
    tag: suggestion ? { id: suggestion.tagId, name: suggestion.name, how: 'suggested' } : null,
  });
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme(mode) },
      createElement(QuickAddView, {
        text: typed,
        onTextChange: vi.fn(),
        onKeyDown: vi.fn(),
        onAdd: vi.fn(),
        onMoreOptions: vi.fn(),
        model,
        saving: false,
        alert: null,
        added: null,
        payers: members.map(({ id, name }) => ({ id, label: id === ALEX.id ? 'You' : name })),
        payerId: payer,
        onPickPayer: vi.fn(),
        tags,
        tagId: suggestion?.tagId ?? null,
        onPickTag: vi.fn(),
        announcement: { id: 0, text: '' },
        ...props,
      }),
    ),
  );
  return { html, model };
}

/** The chips' list items. */
function chipItems(html: string): string[] {
  const list = /<ul\b[^>]*aria-label="How Splitbook reads it"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  return list ? [...list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item]) => item) : [];
}

const part = (item: string, name: 'label' | 'value' | 'spoken') =>
  text(new RegExp(`data-chip-part="${name}"[^>]*>([^<]*)<`).exec(item)?.[1] ?? '');

/** The chips, as each reads on screen: "Amount ₹2,400.00". */
function chips(html: string): string[] {
  return chipItems(html).map((item) => `${part(item, 'label')} ${part(item, 'value')}`);
}

/** What each chip says to a screen reader: a button's name, or the chip's hidden sentence. */
function spoken(html: string): string[] {
  return chipItems(html).map(
    (item) => text(/aria-label="([^"]*)"/.exec(item)?.[1] ?? '') || part(item, 'spoken'),
  );
}

function input(html: string) {
  const tag = /<input\b[^>]*>/.exec(html)![0];
  const attribute = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  return { tag, attribute };
}

function button(html: string, name: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
    ([, , inner]) => text(inner).replace(/\s*↵$/, '') === name,
  );
}

/** The element with this id: its opening tag and its content (no same-tag nesting). */
function byId(html: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(\\w+)\\b([^>]*\\sid="${escaped}"[^>]*)>([\\s\\S]*?)</\\1>`).exec(
    html,
  );
  return { attributes: match?.[2] ?? '', content: text(match?.[3] ?? '') };
}

describe('the Quick add field', () => {
  it('is a labelled field with the canvas’s example, described by the note, before typing', () => {
    const { html } = view('');
    expect(html).toMatch(/<section\b[^>]*aria-labelledby="[^"]+"/);
    const field = input(html);
    expect(field.attribute('placeholder')).toBe(QUICK_ADD_PLACEHOLDER);
    const id = field.attribute('id');
    expect(html).toMatch(new RegExp(`<label\\b[^>]*for="${id}"[^>]*>Quick add</label>`));
    expect(field.attribute('aria-invalid')).toBeNull();
    // Only the note describes the empty field: read out, but not shown until typing starts.
    const describedBy = field.attribute('aria-describedby')!.split(' ');
    expect(describedBy).toHaveLength(1);
    const note = byId(html, describedBy[0]);
    expect(note.content).toBe(QUICK_ADD_NOTE);
    expect(note.attributes).toMatch(/class="[^"]*"/);
    expect(html).toMatch(/clip:rect\(0 0 0 0\)/);
    expect(chips(html)).toEqual([]);
    expect(button(html, 'Add expense')).toBeUndefined();
    expect(html).toContain('role="status"');
  });

  it('reads "Dinner 2400 paid by me" into the canvas’s chips and says what adding does', () => {
    const { html, model } = view('Dinner 2400 paid by me');
    expect(chips(html)).toEqual([
      'Description Dinner',
      'Amount ₹2,400.00',
      'Paid by You',
      'Split Equally · 3',
      `Date ${quickAddDateLabel(TODAY, TODAY)}`,
      'Tag · suggested Food',
    ]);
    expect(quickAddDateLabel(TODAY, TODAY)).toMatch(/^Today, \d{1,2} [A-Z][a-z]{2}$/);
    expect(model.ready).toBe(true);
    expect(text(html)).toContain(
      'Sam and Priya each owe you ₹800.00. Food is a suggestion: adding accepts it, or pick another Tag.',
    );
    const [, attributes] = button(html, 'Add expense')!;
    expect(attributes).not.toMatch(/\sdisabled/);
    const more = button(html, 'More options')!;
    expect(more[1]).toContain('aria-haspopup="dialog"');
    expect(text(html)).toContain(QUICK_ADD_NOTE);
  });

  it('announces each chip, and links the line under them to the field', () => {
    const { html } = view('Dinner 2400 paid by me');
    expect(spoken(html)).toEqual([
      'Description: Dinner',
      'Amount: ₹2,400.00',
      'Paid by: you. Change who paid',
      'Split: equally between everyone, 3. Change the split in more options',
      `Date: ${quickAddDateLabel(TODAY, TODAY)}`,
      'Tag: Food, suggested, not chosen yet. Change Tag',
    ]);
    const describedBy = input(html).attribute('aria-describedby')!.split(' ');
    expect(describedBy).toHaveLength(2);
    expect(byId(html, describedBy[0]).content).toContain('Sam and Priya each owe you');
    expect(byId(html, describedBy[1]).content).toBe(QUICK_ADD_NOTE);
    // Who paid and the Tag open menus; the split opens the full form.
    expect(html).toMatch(/aria-label="Paid by: you\. Change who paid" aria-haspopup="menu"/);
    expect(html).toMatch(/aria-label="Tag: Food, suggested[^"]*" aria-haspopup="menu"/);
    expect(html).toMatch(/aria-label="Split: [^"]*" aria-haspopup="dialog"/);
  });

  it('won’t add until a Tag is chosen when none of the Group’s fits', () => {
    const { html, model } = view('Dinner 2400 paid by me', { tags: HOME_TAGS });
    expect(chips(html)).toContain('Tag · needed Choose one');
    expect(spoken(html)).toContain('Tag needed. Choose a Tag');
    expect(model.ready).toBe(false);
    expect(model.message).toEqual({ text: TAG_NEEDED, tone: 'needed' });
    expect(text(html)).toContain(TAG_NEEDED);
    const [, attributes] = button(html, 'Add expense')!;
    expect(attributes).toMatch(/\sdisabled=""/);
    // Nothing typed is wrong, so the field isn't marked invalid.
    expect(input(html).attribute('aria-invalid')).toBeNull();
  });

  it('suggests a Tag the description names, from the Group’s own', () => {
    const { html, model } = view('Weekly groceries 1240', { tags: HOME_TAGS });
    expect(chips(html)).toContain('Tag · suggested Groceries');
    expect(model.ready).toBe(true);
  });

  it('refuses too many decimal places, marks the field and links the reason', () => {
    const { html, model } = view('Dinner 2400.505');
    expect(chips(html)).toContain('Amount Check decimals');
    expect(spoken(html)).toContain('Amount: 2400.505, check decimals');
    expect(model.ready).toBe(false);
    expect(input(html).attribute('aria-invalid')).toBe('true');
    const [messageId] = input(html).attribute('aria-describedby')!.split(' ');
    expect(byId(html, messageId).content).toBe(
      'INR amounts have at most 2 decimal places. Nothing is rounded for you.',
    );
    expect(button(html, 'Add expense')![1]).toMatch(/\sdisabled=""/);
  });

  it('refuses zero and more than the largest Expense', () => {
    expect(view('Dinner 0').model.message).toEqual({
      text: 'Enter an amount above zero.',
      tone: 'invalid',
    });
    expect(view('Flat 10000000.01').model.message.text).toBe(
      'One Expense can be at most ₹10,000,000.00.',
    );
    expect(chips(view('Flat 10000000.01').html)).toContain('Amount Too large');
  });

  it('asks which member a shared name means', () => {
    const members = [ALEX, SAM, { id: 'a00000000000000000000004', name: 'Sam Lee' }];
    const { html, model } = view('Dinner 2400 paid by Sam', { members });
    expect(chips(html)).toContain('Paid by Which one?');
    expect(model.message.text).toBe(
      'More than one member is called “Sam”: Sam Chen or Sam Lee? Pick who paid.',
    );
    expect(spoken(html)).toContain('Paid by: not clear yet. Choose who paid');
    expect(model.ready).toBe(false);
  });

  it('says what it still needs while the line is incomplete', () => {
    expect(chips(view('Dinner').html)).toEqual(
      expect.arrayContaining(['Description Dinner', 'Amount Needed']),
    );
    expect(view('Dinner').model.message).toEqual({
      text: 'Add an amount, like 2400.',
      tone: 'needed',
    });
    expect(view('2400').model.message.text).toBe('Add what it was for, like Dinner.');
  });

  it('names who shares a split with fewer members, and what the member owes', () => {
    const { html, model } = view('Taxi 900 paid by Sam split with me');
    expect(chips(html)).toContain('Split Equally · You and Sam Chen');
    expect(model.message.text).toContain('You owe Sam ₹450.00.');
    // ₹1,000.01 by three: the two leftover paise go by the shared rule, so the shares differ.
    expect(view('Taxi 1000.01').model.message.text).toContain(
      'Sam and Priya owe you ₹666.67 between them.',
    );
    expect(view('Taxi 1000').model.message.text).toContain('Sam and Priya each owe you ₹333.33.');
    expect(view('Taxi 900 paid by Sam split between Sam and Priya').model.message.text).toContain(
      'It isn’t shared with you',
    );
  });

  it('shows an unconfirmed save as an alert the field points to', () => {
    const { html } = view('Dinner 2400 paid by me', { alert: QUICK_ADD_UNCONFIRMED });
    const alert = /<div\b[^>]*id="([^"]+)"[^>]*role="alert"[^>]*>([\s\S]*?)<\/div>/.exec(html)!;
    expect(text(alert[2])).toBe(QUICK_ADD_UNCONFIRMED);
    expect(input(html).attribute('aria-describedby')!.split(' ')).toContain(alert[1]);
  });

  it('holds the buttons while a save is on its way', () => {
    const { html } = view('Dinner 2400 paid by me', { saving: true });
    expect(button(html, 'Add expense')![1]).toMatch(/\sdisabled=""/);
    expect(button(html, 'More options')![1]).toMatch(/\sdisabled=""/);
    expect(html).toContain('MuiCircularProgress');
  });

  it('confirms what was added once the field is clear', () => {
    const { html } = view('', { added: { description: 'Dinner', amount: '₹2,400.00' } });
    expect(text(html)).toContain('Added Dinner, ₹2,400.00.');
  });

  it('renders in dark mode with the same chips', () => {
    const light = view('Dinner 2400 paid by me').html;
    const dark = view('Dinner 2400 paid by me', {}, 'dark').html;
    expect(chips(dark)).toEqual(chips(light));
  });
});

describe('quickAddDateLabel', () => {
  const day = (year: number, month: number, date: number) =>
    toDateParam(new Date(year, month - 1, date, 12));

  it('says today and yesterday, and a year only when it isn’t this one', () => {
    const today = day(2026, 1, 1);
    expect(quickAddDateLabel(today, today)).toBe('Today, 1 Jan');
    expect(quickAddDateLabel(day(2025, 12, 31), today)).toBe('Yesterday, 31 Dec');
    expect(quickAddDateLabel(day(2025, 12, 30), today)).toBe('30 Dec 2025');
    expect(quickAddDateLabel(day(2026, 3, 5), today)).toBe('5 Mar');
  });
});

describe('the Expenses tab’s Quick add', () => {
  it('renders the empty field for a Group, with nothing read and nothing sent', () => {
    const group = {
      _id: 'c00000000000000000000001',
      name: 'Goa Friends Trip',
      description: '',
      createdBy: ALEX.id,
      defaultCurrency: 'INR',
      currencyLocked: true,
      alternateCurrencies: [],
      category: 'trip',
      startDate: null,
      endDate: null,
      isArchived: false,
      tags: TRIP_TAGS.map(({ id, label }) => ({
        _id: id,
        name: label,
        isArchived: false,
        isDeleted: false,
        createdAt: '2026-09-01T00:00:00.000Z',
      })),
      members: MEMBERS.map(({ id, name }) => ({
        user: { _id: id, name, email: `${name.split(' ')[0].toLowerCase()}@example.test` },
        role: 'member',
        joinedAt: '2026-09-01T00:00:00.000Z',
      })),
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as unknown as GroupRead;
    const html = renderToStaticMarkup(
      createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(QuickAddExpense, {
            groupId: group._id,
            userId: ALEX.id,
            group,
          }),
        ),
      ),
    );
    expect(input(html).attribute('placeholder')).toBe(QUICK_ADD_PLACEHOLDER);
    expect(chips(html)).toEqual([]);
    expect(html).not.toMatch(/@example\.test/);
  });
});
