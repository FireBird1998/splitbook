/**
 * What Balances' "Everyone" card shows for one currency (#313): each person's all-time net as
 * a diverging bar, owed to the right and owes to the left, and who settles with them, in the
 * words the chart, its tooltip and the table share. Pure: the exact figures come from the shared
 * `member-positions` module; this adds names, wording and the bars' lengths.
 */
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import {
  everyoneSettled,
  memberPositions,
  type PositionStanding,
  type SettledByPart,
} from '@splitbook/shared/member-positions';
import type { SettlementLedger } from '@splitbook/shared/settlement-preview';
import { compactMoney } from '@/components/dashboard/spending-chart';

/** Someone who may appear in the chart: a member, or a former member the ledger still names. */
export interface EveryonePerson {
  id: string;
  name: string;
}

/** A run of a sentence: words, or an amount, which is set in the money font. */
export interface PhrasePart {
  text: string;
  money?: boolean;
}

export interface EveryoneRow {
  userId: string;
  /** "You" for the viewer, otherwise their name. */
  name: string;
  /** Their own name, for the avatar's initials (the viewer's included). */
  avatarName: string;
  netMinor: number;
  standing: PositionStanding;
  /** "+₹1,060.00", "−₹1,480.00" or "₹0.00": exact, never shortened. */
  amount: string;
  /** "Gets back", "Owes" or "Settled up". */
  position: string;
  /**
   * Who settles with them: "Gets ₹1,060.00 from you", "Pays Sam ₹1,060.00 and Priya ₹420.00".
   * Empty when nobody does.
   */
  settledBy: PhrasePart[];
  /** The bar's length as a share of the whole axis, 0 to 50; 50 reaches the scale's end. */
  barWidth: number;
}

export interface EveryoneModel {
  currency: string;
  /** Owed first, largest first; then the settled; then owes, largest last. */
  rows: EveryoneRow[];
  /** Nobody owes anybody: there is nothing to chart. */
  settled: boolean;
  /** The axis' two ends, such as −₹1.5K and +₹1.5K. */
  scale: { negative: string; positive: string };
}

export const POSITION_WORDS: Record<PositionStanding, string> = {
  owed: 'Gets back',
  owes: 'Owes',
  settled: 'Settled up',
};

/** The shortest bar for a position that isn't zero, so its direction always shows. */
const MIN_BAR_WIDTH = 1;
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * The axis' end in major units: the largest position rounded up to a round figure (₹1,480.00
 * → ₹1,500), never below one unit, so its short label is always exact.
 */
export function scaleEnd(largest: number): number {
  if (!(largest > 1)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  return NICE_STEPS.map((step) => step * magnitude).find((value) => value >= largest)!;
}

/** "a", "a and b", "a, b and c". */
function listParts(items: PhrasePart[][]): PhrasePart[] {
  return items.flatMap((item, index) => [
    ...(index === 0 ? [] : [{ text: index === items.length - 1 ? ' and ' : ', ' }]),
    ...item,
  ]);
}

/** Adjacent words merged, so a sentence is as few runs as it can be. */
function joinWords(parts: PhrasePart[]): PhrasePart[] {
  return parts.reduce<PhrasePart[]>((runs, part) => {
    const last = runs[runs.length - 1];
    if (last && !last.money && !part.money) last.text += part.text;
    else runs.push({ ...part });
    return runs;
  }, []);
}

/** A sentence's text, money and words alike. */
export function phraseText(parts: readonly PhrasePart[]): string {
  return parts.map((part) => part.text).join('');
}

interface EveryoneModelOptions {
  currency: string;
  /** The signed-in member: "You" in the list, "you" in a sentence. */
  viewerId: string;
  /** Members in the order to list equal positions, then anyone else the ledger names. */
  people: readonly EveryonePerson[];
}

/** The card's figures for one currency of the Group's Balances. */
export function everyoneModel(
  ledger: SettlementLedger,
  { currency, viewerId, people }: EveryoneModelOptions,
): EveryoneModel {
  const names = new Map(people.map((person) => [person.id, person.name.trim()]));
  const nameOf = (id: string) => names.get(id) || 'Former member';
  const firstName = (name: string) => name.split(/\s+/)[0];
  const sharedFirstNames = new Map<string, number>();
  for (const name of names.values())
    if (name)
      sharedFirstNames.set(firstName(name), (sharedFirstNames.get(firstName(name)) ?? 0) + 1);
  // In a sentence: "you", or a first name unless two people share it.
  const inSentence = (id: string) => {
    if (id === viewerId) return 'you';
    const name = names.get(id);
    if (!name) return 'a former member';
    return sharedFirstNames.get(firstName(name))! > 1 ? name : firstName(name);
  };
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(Math.abs(minor), currency), currency);

  const settledBy = (standing: PositionStanding, parts: SettledByPart[]): PhrasePart[] => {
    if (parts.length === 0 || standing === 'settled') return [];
    if (standing === 'owes')
      return joinWords([
        { text: 'Pays ' },
        ...listParts(
          parts.map((part) => [
            { text: `${inSentence(part.userId)} ` },
            { text: money(part.amountMinor), money: true },
          ]),
        ),
      ]);
    return joinWords([
      { text: 'Gets ' },
      ...listParts(
        parts.map((part) => [
          { text: money(part.amountMinor), money: true },
          { text: ` from ${inSentence(part.userId)}` },
        ]),
      ),
    ]);
  };

  const positions = memberPositions(
    ledger,
    people.map((person) => person.id),
  );
  const largest = Math.max(0, ...positions.map((position) => Math.abs(position.netMinor)));
  const end = scaleEnd(toMajorAmount(largest, currency));

  return {
    currency,
    settled: everyoneSettled(positions),
    scale: {
      negative: `−${compactMoney(end, currency)}`,
      positive: `+${compactMoney(end, currency)}`,
    },
    rows: positions.map((position) => {
      const major = toMajorAmount(Math.abs(position.netMinor), currency);
      const width = Math.round((major / end) * 50 * 100) / 100;
      return {
        userId: position.userId,
        name: position.userId === viewerId ? 'You' : nameOf(position.userId),
        avatarName: nameOf(position.userId),
        netMinor: position.netMinor,
        standing: position.standing,
        amount:
          position.standing === 'owed'
            ? `+${money(position.netMinor)}`
            : position.standing === 'owes'
              ? `−${money(position.netMinor)}`
              : money(0),
        position: POSITION_WORDS[position.standing],
        settledBy: settledBy(position.standing, position.settledBy),
        barWidth: position.netMinor === 0 ? 0 : Math.min(50, Math.max(MIN_BAR_WIDTH, width)),
      };
    }),
  };
}
