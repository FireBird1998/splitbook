/**
 * What Quick add (#320) shows for a line it has read: the chips, the line under them and the
 * sentence a screen reader hears. Pure, so the component tests and the field agree.
 */
import { formatCurrency } from '@splitbook/shared/currency';
import { calculateSplitAmountsMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import {
  quickAddSplitMembers,
  type QuickAddMember,
  type QuickAddProblem,
  type QuickAddProblemCode,
  type QuickAddRead,
} from '@splitbook/shared/quick-add';

export type QuickAddChipKey = 'description' | 'amount' | 'payer' | 'split' | 'date' | 'tag';

/** `read`: as typed. `suggested`: a Tag not chosen yet. `needed` and `invalid`: to fix. */
export type QuickAddChipState = 'read' | 'suggested' | 'needed' | 'invalid';

export interface QuickAddChip {
  key: QuickAddChipKey;
  /** The small label above the value: "Amount", "Tag · suggested". */
  label: string;
  value: string;
  state: QuickAddChipState;
  /** What a screen reader hears for it. */
  spoken: string;
}

export interface QuickAddTagChoice {
  id: string;
  name: string;
  /** Picked by the member, or suggested and accepted by adding. */
  how: 'chosen' | 'suggested';
}

export interface QuickAddModelInput {
  read: QuickAddRead;
  /** Today in the viewer's zone, `yyyy-MM-dd`. */
  today: string;
  currency: string;
  viewerId: string;
  members: readonly QuickAddMember[];
  /** Who paid: as read, or as the member picked. */
  payerId: string | null;
  /** What still stands in the way, after the member's picks. */
  problems: QuickAddProblem[];
  tag: QuickAddTagChoice | null;
}

export interface QuickAddModel {
  chips: QuickAddChip[];
  /** The line under the chips: the first thing to fix, the Tag still needed, or what adding does. */
  message: { text: string; tone: 'hint' | 'needed' | 'invalid' };
  /** Whether Enter adds it. */
  ready: boolean;
  /** Whether something typed is refused, so the field is marked invalid. */
  invalid: boolean;
  /** One sentence for screen readers once typing pauses. */
  summary: string;
}

export const TAG_NEEDED = 'Choose a Tag before adding. Every Expense needs one.';

/** The short word a refused amount's chip shows. */
const AMOUNT_CHECKS: Partial<Record<QuickAddProblemCode, string>> = {
  'amount-decimals': 'Check decimals',
  'amount-zero': 'Above zero',
  'amount-negative': 'Above zero',
  'amount-too-large': 'Too large',
  'amount-format': 'Check format',
  'amount-currency': 'Check currency',
  'amount-several': 'Keep one',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today, 7 Oct", "Yesterday, 6 Oct", "5 Oct", "28 Dec 2025": read from the string, no zone. */
export function quickAddDateLabel(date: string, today: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const short = `${day} ${MONTHS[month - 1]}`;
  if (date === today) return `Today, ${short}`;
  const before = new Date(0);
  const [y, m, d] = today.split('-').map(Number);
  before.setUTCFullYear(y, m - 1, d - 1);
  const yesterday = `${String(before.getUTCFullYear()).padStart(4, '0')}-${String(before.getUTCMonth() + 1).padStart(2, '0')}-${String(before.getUTCDate()).padStart(2, '0')}`;
  if (date === yesterday) return `Yesterday, ${short}`;
  return year === y ? short : `${short} ${year}`;
}

/** "Sam and Priya", "Ann, Ben and Cal". */
function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Build what Quick add shows. The money in the hint comes from the shared largest-remainder
 * split, so "each owe you ₹800.00" is what the saved Expense will say.
 */
export function quickAddModel({
  read,
  today,
  currency,
  viewerId,
  members,
  payerId,
  problems,
  tag,
}: QuickAddModelInput): QuickAddModel {
  const problemFor = (field: QuickAddProblem['field']) =>
    problems.find((problem) => problem.field === field);
  const stateFor = (field: QuickAddProblem['field']): QuickAddChipState => {
    const problem = problemFor(field);
    return problem ? problem.kind : 'read';
  };
  const nameOf = (id: string) =>
    id === viewerId ? 'You' : (members.find((member) => member.id === id)?.name ?? 'Unknown');
  // First names read naturally ("Sam and Priya"); a shared first name keeps the whole name.
  const shortName = (id: string) => {
    if (id === viewerId) return 'you';
    const name = nameOf(id);
    const first = name.split(/\s+/u)[0];
    const shared = members.filter(
      (member) => member.id !== id && member.name.split(/\s+/u)[0] === first,
    );
    return shared.length ? name : first;
  };
  const money = (minor: number) => formatCurrency(toMajorAmount(minor, currency), currency);

  const selected = quickAddSplitMembers(read, payerId, members);
  const amountProblem = problemFor('amount');
  const splitProblem = problemFor('split');
  const dateProblem = problemFor('date');
  const payerProblem = problemFor('payer');

  const chips: QuickAddChip[] = [];
  const description = read.description || 'Needed';
  chips.push({
    key: 'description',
    label: 'Description',
    value: description,
    state: stateFor('description'),
    spoken: `Description: ${read.description || 'needed'}`,
  });
  const amount =
    read.amountMinor !== null
      ? money(read.amountMinor)
      : amountProblem?.kind === 'invalid'
        ? (AMOUNT_CHECKS[amountProblem.code] ?? 'Check amount')
        : 'Needed';
  chips.push({
    key: 'amount',
    label: 'Amount',
    value: amount,
    state: stateFor('amount'),
    spoken: `Amount: ${read.amountMinor !== null ? amount : amountProblem?.kind === 'invalid' ? `${read.amountText ?? 'refused'}, ${amount.toLowerCase()}` : 'needed'}`,
  });
  const payer = payerId
    ? nameOf(payerId)
    : read.payer.candidates.length
      ? 'Which one?'
      : payerProblem?.code === 'payer-several'
        ? 'One person'
        : 'Who?';
  chips.push({
    key: 'payer',
    label: 'Paid by',
    value: payer,
    state: payerProblem ? payerProblem.kind : 'read',
    spoken: payerId
      ? `Paid by: ${payer === 'You' ? 'you' : payer}. Change who paid`
      : 'Paid by: not clear yet. Choose who paid',
  });
  const everyone = read.split.mode === 'all' || selected.length === members.length;
  const split = splitProblem
    ? 'Check names'
    : everyone
      ? `Equally · ${selected.length}`
      : selected.length <= 3
        ? `Equally · ${list(selected.map(nameOf))}`
        : `Equally · ${selected.length} of ${members.length}`;
  chips.push({
    key: 'split',
    label: 'Split',
    value: split,
    state: stateFor('split'),
    spoken: splitProblem
      ? 'Split: check the names. Change the split in more options'
      : `Split: equally between ${everyone ? `everyone, ${selected.length}` : list(selected.map((id) => (id === viewerId ? 'you' : nameOf(id))))}. Change the split in more options`,
  });
  const date = dateProblem ? 'Check date' : quickAddDateLabel(read.date, today);
  chips.push({
    key: 'date',
    label: 'Date',
    value: date,
    state: stateFor('date'),
    spoken: `Date: ${date}`,
  });
  chips.push({
    key: 'tag',
    label: tag ? (tag.how === 'suggested' ? 'Tag · suggested' : 'Tag') : 'Tag · needed',
    value: tag?.name ?? 'Choose one',
    state: tag ? (tag.how === 'suggested' ? 'suggested' : 'read') : 'needed',
    spoken: tag
      ? tag.how === 'suggested'
        ? `Tag: ${tag.name}, suggested, not chosen yet. Change Tag`
        : `Tag: ${tag.name}. Change Tag`
      : 'Tag needed. Choose a Tag',
  });

  let message: QuickAddModel['message'];
  if (problems.length) {
    message = {
      text: problems[0].message,
      tone: problems[0].kind === 'invalid' ? 'invalid' : 'needed',
    };
  } else if (!tag) {
    message = { text: TAG_NEEDED, tone: 'needed' };
  } else {
    const position = positionSentence(read.amountMinor!, selected, payerId!);
    const suggestion =
      tag.how === 'suggested'
        ? ` ${tag.name} is a suggestion: adding accepts it, or pick another Tag.`
        : '';
    message = { text: `${position}${suggestion}`, tone: 'hint' };
  }

  function positionSentence(totalMinor: number, sharing: string[], paidBy: string): string {
    const shares = new Map(
      calculateSplitAmountsMinor(
        'equal',
        totalMinor,
        sharing.map((user) => ({ user })),
      ).map((row) => [row.user, row.amountMinor]),
    );
    if (paidBy === viewerId) {
      const others = sharing.filter((id) => id !== viewerId);
      if (others.length === 0) return 'Only you share it, so nobody owes you anything.';
      const owed = others.map((id) => shares.get(id) ?? 0);
      const names = list(others.map(shortName));
      if (owed.every((minor) => minor === owed[0]))
        return `${names} ${others.length === 1 ? 'owes' : 'each owe'} you ${money(owed[0])}.`;
      return `${names} owe you ${money(owed.reduce((sum, minor) => sum + minor, 0))} between them.`;
    }
    const mine = shares.get(viewerId);
    return mine === undefined
      ? `It isn’t shared with you, so it doesn’t change your balance.`
      : `You owe ${shortName(paidBy)} ${money(mine)}.`;
  }

  const ready = problems.length === 0 && tag !== null;
  return {
    chips,
    message,
    ready,
    invalid: problems.some((problem) => problem.kind === 'invalid'),
    summary: `${chips.map((chip) => `${chip.label}: ${chip.value}`).join('. ')}. ${message.text}`,
  };
}
