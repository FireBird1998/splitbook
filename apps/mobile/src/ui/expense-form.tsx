import { readExpenseDraft } from '../data/expense-draft';
import type { ViewInstance, TextInputInstance, TextStyle, ViewStyle } from 'react-native';
import {
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { EXPENSE_CATEGORIES, getCategory } from '@splitbook/shared/categories';
import { formatCurrency, wholeUnit } from '@splitbook/shared/currency';
import {
  maxExpenseAmountMinor,
  parseAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import {
  isMoneyField,
  type ExpenseMoneyField,
  type ExpenseVersionField,
} from '@splitbook/shared/expense-review';
import {
  expenseFieldLabels,
  type ExpenseDraft,
  type ExpenseField,
  type expenseMoney,
} from '../data/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import { AmountField, DescriptionField, NotesField } from './expense-inputs';
import {
  SelectedAmountField,
  SelectedDescriptionField,
  SelectedNotesField,
} from './expense-input-selection';
import { spellDay } from './day-format';
import { FieldError } from './group-workflows';
import { Icon } from './primitives';
import {
  Badge,
  Card,
  Chip,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  FieldMarker,
  Money,
  SelectorTile,
  TileGrid,
  avatarSize,
  headingBeside,
  headingLine,
  isLargeText,
  moneyWidth,
  scaledSp,
  textVariants,
  useLargeText,
  useLargestText,
  useShortWindow,
  useTap,
  widestRegularWord,
} from './compact';
import { outfitWidth } from './compact/outfit-metrics';
import { useTheme } from './theme';
import { SEPARATOR } from '@splitbook/shared/separator';
import { amountError } from '../data/field-feedback';

type Allocation = ReturnType<typeof expenseMoney>;
type SectionRef = (field: ExpenseField) => (node: ViewInstance | null) => void;

const splitSummaries: Record<ExpenseDraft['splitMethod'], string> = {
  equal: 'Equally',
  unequal: 'By amounts',
  exact: 'By amounts',
  percentage: 'By percentage',
  shares: 'By shares',
};

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * The Date tile's value for a YYYY-MM-DD draft date, on the Gregorian calendar in the device's
 * language and day first (#640). `shown` fits a half-width tile on a 360dp phone:
 * "Today, 30 Sep", "Thu 1 Oct" or "24 Sep 2025". `spoken` is the full date, such as
 * "Yesterday, Thursday 1 October 2026".
 */
export function expenseDateLabel(value: string, now = Date.now()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!date || localDay(date) !== value) {
    const shown = value || 'Choose a date';
    return { shown, spoken: shown };
  }
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const thisYear = date.getFullYear() === today.getFullYear();
  const short = spellDay(date, { year: !thisYear });
  const full = spellDay(date, { weekday: 'long', month: 'long', year: true });
  if (value === localDay(today)) return { shown: `Today, ${short}`, spoken: `Today, ${full}` };
  return {
    shown: thisYear ? spellDay(date, { weekday: 'short' }) : short,
    spoken: value === localDay(yesterday) ? `Yesterday, ${full}` : full,
  };
}

export const splitSummary = (draft: ExpenseDraft) =>
  `${splitSummaries[draft.splitMethod]}${SEPARATOR}${draft.participantIds.length}`;

/**
 * Amount with its currency, then Description: the two typed values. The currency opens the
 * Currency sheet when the Group has more than one (#720); otherwise it is read-only.
 */
export const AmountDescriptionCard = memo(function AmountDescriptionCard({
  draft,
  locked,
  showLock = false,
  errors,
  amountRef,
  descriptionRef,
  section,
  onChange,
  onLeave,
  onAmountDone,
  onCurrency,
  currencyLocked,
  children,
  controller,
}: {
  controller?: MobileController;
  draft: ExpenseDraft;
  locked: boolean;
  /** Shows the values as locked, as for a save that may already be recorded. */
  showLock?: boolean;
  errors: { amount?: string; description?: string };
  amountRef: Ref<TextInputInstance>;
  descriptionRef: Ref<TextInputInstance>;
  section: SectionRef;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onLeave: (field: ExpenseField) => void;
  /** The keyboard's next key on Amount: moves on to Description. */
  onAmountDone: () => void;
  /** Opens the Currency sheet; absent while the Group has only its main currency. */
  onCurrency?: () => void;
  currencyLocked?: boolean;
  /** Notes about the amount, such as a changed Group currency. */
  children?: ReactNode;
}) {
  const props = {
    draft,
    locked,
    showLock,
    errors,
    amountRef,
    descriptionRef,
    section,
    onChange,
    onLeave,
    onAmountDone,
    onCurrency,
    currencyLocked,
  };
  return (
    <Card
      state={errors.amount || errors.description ? 'error' : showLock ? 'locked' : 'default'}
      padded
    >
      {controller ? (
        <SelectedAmountField controller={controller} {...props} />
      ) : (
        <AmountField {...props} />
      )}
      {children}
      <View style={{ marginVertical: 12, marginHorizontal: -14 }}>
        <Divider inset={14} />
      </View>
      {controller ? (
        <SelectedDescriptionField controller={controller} {...props} />
      ) : (
        <DescriptionField {...props} />
      )}
    </Card>
  );
});

/** Date, Paid by, Split and Tag; each opens its editor. Their corrections follow the grid. */
export const ExpenseTiles = memo(function ExpenseTiles({
  locked,
  financialLocked = locked,
  tagLocked = financialLocked,
  errors,
  values,
  correction,
  section,
  onOpen,
}: {
  locked: boolean;
  financialLocked?: boolean;
  /** Offline, the Tag can be chosen from the saved Tags while other choices wait (#638). */
  tagLocked?: boolean;
  errors: Partial<Record<'date' | 'payers' | 'split' | 'tag', string>>;
  values: {
    date: ReturnType<typeof expenseDateLabel>;
    payers: string;
    split: string;
    tag: string;
  };
  correction: (field: ExpenseField) => Ref<ViewInstance>;
  section: SectionRef;
  onOpen: (tile: 'date' | 'payers' | 'split' | 'tag') => void;
}) {
  const fields = ['date', 'payers', 'split', 'tag'] as const;
  return (
    // Every tile's correction reveals the grid.
    <View ref={(node) => fields.forEach((field) => section(field)(node))} style={{ gap: 8 }}>
      <TileGrid>
        <SelectorTile
          icon="calendar-outline"
          label="Date"
          value={values.date.shown}
          spokenValue={values.date.spoken}
          error={errors.date}
          locked={locked}
          onPress={() => onOpen('date')}
        />
        <SelectorTile
          icon="wallet-outline"
          label="Paid by"
          value={values.payers}
          error={errors.payers}
          locked={financialLocked}
          onPress={() => onOpen('payers')}
        />
        <SelectorTile
          icon="pie-chart-outline"
          label="Split"
          value={values.split}
          error={errors.split}
          locked={financialLocked}
          onPress={() => onOpen('split')}
        />
        <SelectorTile
          icon="pricetag-outline"
          label="Tag"
          value={values.tag}
          required
          error={errors.tag}
          locked={tagLocked}
          onPress={() => onOpen('tag')}
        />
      </TileGrid>
      {fields.map((field) => (
        <FieldError key={field} ref={correction(field)} message={errors[field]} />
      ))}
    </View>
  );
});

/**
 * "Who owes what": each person's paid amount and share, an "Adds up" badge and the totals.
 * With more than four people it shows three and "Show all".
 */
/** A saved Expense's record, under an equal split whose shares differ by the smallest unit. */
export const sharesDifferNote = 'Shares differ by the smallest unit so the whole amount is shared.';
/**
 * The form, under every equal split: true before the amount and whatever it is, so the note never
 * comes or goes as the amount is typed (#941). "smallest unit" is kept on one line.
 */
export const sharesMayDifferNote =
  'If it doesn’t divide evenly, shares differ by the smallest\u00a0unit.';

const AllocationHeading = memo(function AllocationHeading({
  savedLabel,
  currency,
  waiting = false,
}: {
  savedLabel?: string;
  /** The form's Expense currency, beside the heading (#720): every share is in it. */
  currency?: string;
  /** No amount yet: nothing adds up, so the badge says so in the same place (#911). */
  waiting?: boolean;
}) {
  return (
    // At large text the badge goes under the heading, at the row's end, where they can't share a
    // line: at 200% on a 360 dp phone it was cut at the card's edge (#876).
    <View style={{ ...headingLine, gap: 8, paddingHorizontal: 14, paddingTop: 12 }}>
      <CompactText variant="overline" accessibilityRole="header" spare style={headingBeside}>
        {currency
          ? // "· whole yen" for a currency without a smaller unit, as the web says (#720).
            `Who owes what${SEPARATOR}${currency}${wholeUnit(currency) ? `${SEPARATOR}whole ${wholeUnit(currency)}` : ''}`
          : 'Who owes what'}
      </CompactText>
      {savedLabel ? (
        <CompactText variant="caption" tone="secondary">
          {savedLabel}
        </CompactText>
      ) : waiting ? (
        <Badge label="No amount" />
      ) : (
        <Badge label="Adds up" tone="positive" icon="checkmark" />
      )}
    </View>
  );
});
const AllocationColumns = memo(function AllocationColumns() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 14,
        paddingTop: 6,
      }}
    >
      {['Paid', 'Share'].map((heading) => (
        <CompactText
          key={heading}
          variant="caption"
          tone="secondary"
          style={{ minWidth: amountColumn, textAlign: 'right' }}
        >
          {heading}
        </CompactText>
      ))}
    </View>
  );
});
const AllocationPersonLabel = memo(function AllocationPersonLabel({
  name,
  person,
  stacked,
}: {
  name: string;
  person: string;
  stacked: boolean;
}) {
  return (
    <>
      <CompactAvatar name={name} small />
      <CompactText numberOfLines={stacked ? undefined : 2} style={{ flex: 1, minWidth: 0 }}>
        {person}
      </CompactText>
    </>
  );
});
/** The least width of Who owes what's Paid and Share columns: "₹1,24,999.50" in the table face. */
const amountColumn = 84;

/**
 * Whether Who owes what puts each person's Paid and Share under their name, as the record's
 * skeleton does too: at large text, on a narrow screen, and where a word of a name is wider than
 * the room beside the two columns, the window less the screen's gutter, the Card's border, the
 * row's padding, the avatar and the three gaps. At 100% on a 412 dp phone that room is 126 dp, and
 * "Venkataraghavan-" (129 dp) broke inside the word, "Priyamvada Venk / ataraghavan-S…" (#926);
 * under it, the name has the row's width and breaks only at a space or after its hyphen. `names`
 * are everyone's, those behind Show all too, and not the amounts, so the table keeps its shape
 * when the amount comes or the list opens (#911). A name whose widths aren't known here keeps the
 * columns.
 */
export function allocationStacked(names: readonly string[], width: number, fontScale: number) {
  if (isLargeText(fontScale) || width < 360) return true;
  const room = width - 2 * 16 - 2 - 2 * 14 - avatarSize.small - 3 * 10 - 2 * amountColumn;
  const size = scaledSp(Number(textVariants.body.fontSize), fontScale);
  return names.some((name) => {
    const widest = widestRegularWord(name);
    return widest !== null && Math.ceil(widest * size) + 1 > room;
  });
}

/**
 * A label and its amount in the stacked Who owes what, "Paid CHF 10,000,000.00": on one line where
 * they fit, the amount under the label where they don't (#925). The record's skeleton keeps it.
 */
export const amountPair = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  columnGap: 6,
  rowGap: 2,
} as const;

/**
 * How wide each of one kind of figure in the stacked Who owes what is drawn: as wide as the widest
 * of them in the table (`figures`, everyone's Paid or everyone's Share, "–" for nothing), up to
 * the room under a name. Every row's pairs are then as wide as each other, so "Share" starts at
 * one x in every row, beside Paid or under it, and the figures end together (#932). Before, it
 * started wherever that row's Paid ended. The record's skeleton keeps it.
 */
export function stackedFigure(figures: readonly string[], width: number, fontScale: number) {
  const room = width - 2 * 16 - 2 - 2 * 14 - 36;
  // As Android draws it (`moneyWidth`): measured narrower, a wide figure outgrew its width and
  // moved that row's Share (#932).
  const widest = Math.max(0, ...figures.map((figure) => moneyWidth(figure, 'table', fontScale)));
  return { minWidth: Math.min(room, widest), textAlign: 'right' as const };
}

/** A stacked pair's label and figure styles: their widths, and how the figure sits in its own. */
type PairStyles = { label?: TextStyle; figure?: TextStyle };

/**
 * The row the stacked pairs share under a name, "Paid ₹…" then "Share ₹…": beside each other where
 * they fit, Share under Paid where they don't (`stackedPairStyles`). The record's skeleton keeps it.
 */
export const stackedPairsRow = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  columnGap: 16,
  rowGap: 2,
  paddingLeft: 36,
} as const;

/**
 * How each stacked pair, "Paid ₹…" and "Share ₹…", is laid out under a name, from everyone's Paid
 * figures and everyone's Share figures ("–" for nothing), so every row lays its pairs out alike:
 * - Side by side where both fit, each figure as wide as the widest of its kind (`stackedFigure`):
 *   "Share" starts at one x in every row (#932).
 * - Share under Paid otherwise, the labels as wide as each other and the figures too, so the
 *   figures end at one x, a column of them, dashes and all.
 * - Where a label and the widest figure can't share a line, as for CHF 10,000,000.00 at 200% on a
 *   360 dp phone, each figure is as wide as itself: a dash stays beside "Paid" rather than drop to
 *   a line of its own at the card's edge, and a figure that goes under its label starts where the
 *   label does (#932). The pairs then go under each other (`row`) whatever their widths: a row
 *   whose Paid and Share are both short, "Paid –" and "Share ₹1.00", would otherwise fit them on
 *   one line while the others stack (#937).
 * The labels' widths are Outfit's, never less than Android draws them, so a pair is never
 * narrower than this takes it to be, and Share is under Paid wherever this says it is.
 */
export function stackedPairStyles(
  paid: readonly string[],
  share: readonly string[],
  width: number,
  fontScale: number,
): Record<'Paid' | 'Share', PairStyles> & { row?: ViewStyle } {
  const room = width - 2 * 16 - 2 - 2 * 14 - 36;
  const gap = amountPair.columnGap;
  const caption = scaledSp(Number(textVariants.caption.fontSize), fontScale);
  const label = (word: string) => Math.ceil((outfitWidth(word) ?? 0) * caption);
  const figures = {
    Paid: stackedFigure(paid, width, fontScale),
    Share: stackedFigure(share, width, fontScale),
  };
  const beside =
    label('Paid') +
    gap +
    figures.Paid.minWidth +
    16 +
    label('Share') +
    gap +
    figures.Share.minWidth;
  if (beside <= room) return { Paid: { figure: figures.Paid }, Share: { figure: figures.Share } };
  const labelWidth = Math.max(label('Paid'), label('Share'));
  const figureWidth = Math.max(figures.Paid.minWidth, figures.Share.minWidth);
  if (labelWidth + gap + figureWidth > room)
    return { Paid: {}, Share: {}, row: { flexDirection: 'column', alignItems: 'flex-start' } };
  const under = {
    label: { minWidth: labelWidth },
    figure: { minWidth: figureWidth, textAlign: 'right' as const },
  };
  return { Paid: under, Share: under };
}

/**
 * Whether Who owes what waits for the amount, keeping its rows with a dash for each figure: there
 * is no amount it can use yet, whether none, one typed in part (a sub-unit amount passes through
 * "0" and "0.") or one corrected beside the field. Folding the table there would move Notes
 * (#911). A usable amount that the split can't share keeps its own message.
 */
export const waitsForAmount = (
  draft: Pick<ExpenseDraft, 'amount' | 'currency'>,
  allocation: Allocation | null,
  amountCorrection: string | undefined,
) => !allocation && (!!amountCorrection || !!amountError(draft.amount, draft.currency));

/**
 * The room the sum line keeps, unseen and unread: the line at the widest amount the currency
 * allows (`widest`, its digits all "0", Outfit's widest). Android lays it out as it would the sum
 * line, so no amount takes more lines than it keeps: before, at 200% on a 360 dp phone, "Enter an
 * amount first." took one line and "₹900.00 paid = ₹900.00 shared." two, so typing the amount
 * moved Category and notes (#941). The sum line is drawn over it (`sumLineOver`).
 */
const TotalsRoom = memo(function TotalsRoom({ widest }: { widest: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ opacity: 0 }}
    >
      <CompactText variant="small">
        {widest} paid = {widest} shared.
      </CompactText>
    </View>
  );
});
/** An equal split's note, the same at every amount, so typing one doesn't render it again. */
const SharesMayDiffer = memo(function SharesMayDiffer() {
  return (
    <CompactText variant="caption" tone="muted">
      {sharesMayDifferNote}
    </CompactText>
  );
});
/** The sum line, over the room `TotalsRoom` keeps for it. */
const sumLineOver = { position: 'absolute', top: 0, left: 0, right: 0 } as const;

export const WhoOwesWhat = memo(function WhoOwesWhat({
  draft,
  allocation,
  problem,
  name,
  currentUserId,
  money,
  saved = false,
  waiting = false,
  corrected = false,
}: {
  draft: ExpenseDraft;
  allocation: Allocation | null;
  /** Why there is no allocation to show yet. */
  problem: string;
  /**
   * There is no amount yet, and nothing to correct: the table shows the draft's members with a
   * dash for each figure, at the height the amount will give it, so typing the amount (while the
   * Group is checked too) moves nothing below it (#911).
   */
  waiting?: boolean;
  /** The amount has a correction beside it: the table asks for that, not for an amount. */
  corrected?: boolean;
  name: (id: string) => string;
  currentUserId?: string;
  money: (minor: number) => string;
  /** A saved Expense's record: names the split method instead of checking the totals. */
  saved?: boolean;
}) {
  const theme = useTheme();
  const [all, setAll] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const person = (id: string) => (id === currentUserId ? 'You' : name(id));
  if (!allocation && !waiting)
    return (
      <Card padded>
        <CompactText variant="overline">Who owes what</CompactText>
        <CompactText tone="secondary" style={{ marginTop: 6 }}>
          {problem}
        </CompactText>
      </Card>
    );
  // Waiting, each payer's and member's figure is still to come (null): a dash in the amount's
  // own face, so each row is as tall as it will be.
  const paid = new Map<string, number | null>(
    allocation
      ? allocation.paidBy.map((row) => [String(row.user), row.amountMinor])
      : readExpenseDraft(draft)
          .payers.ids.filter(Boolean)
          .map((user) => [user, null]),
  );
  const shares = new Map<string, number | null>(
    allocation
      ? allocation.splitBetween.map((row) => [String(row.user), row.amountMinor])
      : draft.participantIds.map((user) => [user, null]),
  );
  // The signed-in member first, then everyone else in the Group's order.
  const people = [...new Set([...shares.keys(), ...paid.keys()])].sort(
    (a, b) => Number(b === currentUserId) - Number(a === currentUserId),
  );
  const shown = people.length > 4 && !all ? people.slice(0, 3) : people;
  // At large text, on a narrow screen, or beside a word too wide for the room the amounts leave,
  // each person's amounts sit under their name (#926).
  const stacked = allocationStacked(people.map(person), width, fontScale);
  const shareValues = allocation ? allocation.splitBetween.map((row) => row.amountMinor) : [];
  const rounded =
    draft.splitMethod === 'equal' &&
    shareValues.length > 1 &&
    Math.max(...shareValues) !== Math.min(...shareValues);
  // Wide enough for "₹1,24,999.50" in the table face. Money is never cut short: a longer
  // amount widens its column, and names wrap instead.
  const column = { minWidth: amountColumn, alignItems: 'flex-end' as const };
  // Nothing, or a figure still to come, is a dash in the amount's own face: stacked, "Paid –"
  // then sits on the same baseline as "Share ₹…" (#932).
  const figure = (minor: number | null | undefined) =>
    minor === undefined || minor === null ? '–' : money(minor);
  const amount = (minor: number | null | undefined, style?: TextStyle) => (
    <Money
      size="table"
      numberOfLines={0}
      tone={minor === undefined || minor === null ? 'muted' : undefined}
      style={style}
    >
      {figure(minor)}
    </Money>
  );
  // Stacked, every row lays its pairs out alike, from everyone's figures, so "Share" starts at one
  // x in every row (#932). Never narrower than the currency's zero, the shortest an amount is
  // written: Share then sits beside or under the dashes before the amount as it will beside or
  // under the shortest amount, and typing one doesn't move Notes (#911).
  const pairs = stacked
    ? stackedPairStyles(
        [money(0), ...people.map((id) => figure(paid.get(id)))],
        [money(0), ...people.map((id) => figure(shares.has(id) ? shares.get(id)! : 0))],
        width,
        fontScale,
      )
    : null;
  const spoken = (minor: number | null | undefined) =>
    minor === undefined ? 'nothing' : money(minor as number);
  // A figure that waits for the amount says so; "paid and share" when both do (#911).
  const rowLabel = (
    id: string,
    paidMinor: number | null | undefined,
    shareMinor: number | null | undefined,
  ) => {
    const waits = (minor: number | null | undefined) => minor === null;
    if (waits(paidMinor) && waits(shareMinor))
      return `${person(id)}: paid and share wait for the amount`;
    const paid = waits(paidMinor) ? 'paid waits for the amount' : `paid ${spoken(paidMinor)}`;
    const share = waits(shareMinor) ? 'share waits for the amount' : `share ${spoken(shareMinor)}`;
    return `${person(id)}: ${paid}, ${share}`;
  };
  return (
    <Card>
      <AllocationHeading
        savedLabel={saved ? splitSummary(draft) : undefined}
        currency={draft.currency}
        waiting={!allocation}
      />
      {stacked ? <View style={{ height: 6 }} /> : <AllocationColumns />}
      {shown.map((id) => {
        const paidMinor = paid.get(id);
        const shareMinor = shares.has(id) ? shares.get(id)! : 0;
        return (
          <View
            key={id}
            accessible
            accessibilityLabel={rowLabel(id, paidMinor, shareMinor)}
            style={{
              minHeight: 48,
              justifyContent: 'center',
              gap: 2,
              paddingHorizontal: 14,
              paddingVertical: stacked ? 6 : 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <AllocationPersonLabel name={name(id)} person={person(id)} stacked={stacked} />
              {stacked ? null : (
                <>
                  <View style={column}>{amount(paidMinor)}</View>
                  <View style={column}>{amount(shareMinor)}</View>
                </>
              )}
            </View>
            {stacked ? (
              <View style={[stackedPairsRow, pairs!.row]}>
                {(
                  [
                    ['Paid', paidMinor],
                    ['Share', shareMinor],
                  ] as const
                ).map(([label, minor]) => (
                  // Where a label and its amount don't fit on one line, the amount goes under the
                  // label: at 200% on a 360 dp phone, the pair ran past the card and its edge cut
                  // "Paid CHF 10,000,000.(" (#925).
                  <View key={label} style={amountPair}>
                    <CompactText variant="caption" tone="secondary" style={pairs![label].label}>
                      {label}
                    </CompactText>
                    {amount(minor, pairs![label].figure)}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {people.length > 4 ? (
        <View style={{ paddingHorizontal: 6 }}>
          <CompactButton
            label={all ? 'Show fewer' : `Show all ${people.length}`}
            variant="text"
            dense
            onPress={() => setAll(!all)}
          />
        </View>
      ) : null}
      {saved && !rounded ? (
        <View style={{ height: 8 }} />
      ) : (
        <View
          style={{
            marginTop: 4,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            padding: 14,
            gap: 4,
          }}
        >
          {saved ? (
            <CompactText variant="caption" tone="secondary">
              {sharesDifferNote}
            </CompactText>
          ) : (
            <>
              <View>
                {/* The room the widest amount's sum line would take (#941). */}
                <TotalsRoom
                  widest={money(maxExpenseAmountMinor(draft.currency)).replace(/\d/g, '0')}
                />
                <View style={sumLineOver}>
                  {allocation ? (
                    <CompactText variant="small">
                      {money(allocation.amountMinor)} paid = {money(allocation.amountMinor)} shared.
                    </CompactText>
                  ) : (
                    <CompactText variant="small" tone="secondary">
                      {corrected ? 'Correct the amount first.' : 'Enter an amount first.'}
                    </CompactText>
                  )}
                </View>
              </View>
              {draft.splitMethod === 'equal' ? <SharesMayDiffer /> : null}
            </>
          )}
        </View>
      )}
    </Card>
  );
});

const versionLabels: Record<ExpenseVersionField, string> = {
  ...expenseFieldLabels,
  category: 'Category',
  notes: 'Notes',
};
const reviewNames: Record<ExpenseMoneyField, string> = {
  amount: 'amount',
  payers: 'payers',
  split: 'split',
};
interface VersionNames {
  name: (id: string) => string;
  tagName: (id: string) => string;
  currentUserId?: string;
}

/** One field of one version as the member reads it; empty when there is nothing. */
function versionText(
  draft: ExpenseDraft,
  field: ExpenseVersionField,
  { name, tagName, currentUserId }: VersionNames,
) {
  const person = (id: string) => (id === currentUserId ? 'You' : name(id));
  const money = (value: string) => {
    try {
      const minor = parseAmountMinor(value, draft.currency);
      return formatCurrency(toMajorAmount(minor, draft.currency), draft.currency);
    } catch {
      return value && `${draft.currency} ${value}`;
    }
  };
  switch (field) {
    case 'amount':
      return money(draft.amount);
    case 'description':
      return draft.description.trim();
    case 'date':
      // The tile's short form, which fits the table's narrow columns.
      return expenseDateLabel(draft.date).shown;
    case 'payers': {
      const payers = draft.multiPayer
        ? draft.payers
        : [{ user: draft.payerId, amount: draft.amount }];
      return payers.length === 1
        ? person(payers[0].user)
        : payers.map((row) => `${person(row.user)} ${money(row.amount)}`).join(', ');
    }
    case 'split': {
      const value = (user: string) => draft.splitValues[user] || '0';
      const shares = draft.participantIds.map((user) =>
        draft.splitMethod === 'equal'
          ? person(user)
          : draft.splitMethod === 'percentage'
            ? `${person(user)} ${value(user)}%`
            : draft.splitMethod === 'shares'
              ? `${person(user)} ${value(user)}`
              : `${person(user)} ${money(value(user))}`,
      );
      return `${splitSummaries[draft.splitMethod]}: ${shares.join(', ')}`;
    }
    case 'tag':
      return tagName(draft.tagId);
    case 'category':
      return getCategory(draft.category)?.label ?? draft.category;
    case 'notes':
      return draft.notes.trim();
  }
}

/**
 * "What's different": each field that differs between the member's version and the saved
 * Expense. With `onChoose`, each money field offers keeping theirs or using the saved value.
 */
export function WhatsDifferent({
  fields,
  yours,
  saved,
  note,
  onChoose,
  ref,
  ...names
}: {
  fields: readonly ExpenseVersionField[];
  yours: ExpenseDraft;
  saved: ExpenseDraft;
  /** What choosing does, under the table. */
  note: string;
  onChoose?: (field: ExpenseMoneyField, keep: 'mine' | 'saved') => void;
  /** The heading, where the table is scrolled to and focused. */
  ref?: Ref<ViewInstance>;
} & VersionNames) {
  const theme = useTheme();
  // At large text sizes each version gets its own line instead of a column.
  const large = useLargeText();
  // The saved version is in the warning tone, as in the banner above.
  const value = (field: ExpenseVersionField, text: string, side: 'yours' | 'saved') => {
    const shown = large
      ? `${side === 'saved' ? 'Saved now' : 'Yours'}: ${text || '–'}`
      : text || '–';
    const tone = side === 'saved' ? 'warning' : 'primary';
    const style = large ? undefined : { flex: 1, minWidth: 0, textAlign: 'right' as const };
    return field === 'amount' && !large ? (
      <Money size="table" tone={tone} style={style}>
        {shown}
      </Money>
    ) : (
      <CompactText variant="small" tone={tone} style={style}>
        {shown}
      </CompactText>
    );
  };
  return (
    <Card>
      <View
        ref={ref}
        accessible
        accessibilityRole="header"
        accessibilityLabel="What’s different"
        style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}
      >
        <CompactText variant="overline">What’s different</CompactText>
      </View>
      {fields.length && !large ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 2 }}
        >
          <View style={{ width: 84 }} />
          {['Yours', 'Saved now'].map((heading) => (
            <CompactText
              key={heading}
              variant="caption"
              tone="secondary"
              style={{ flex: 1, textAlign: 'right' }}
            >
              {heading}
            </CompactText>
          ))}
        </View>
      ) : null}
      {fields.length ? (
        fields.map((field) => {
          const label = versionLabels[field];
          const mine = versionText(yours, field, names);
          const theirs = versionText(saved, field, names);
          return (
            <View key={field} style={{ gap: 2, paddingHorizontal: 14, paddingVertical: 6 }}>
              <View
                accessible
                accessibilityLabel={`${label}: yours ${mine || 'none'}, saved now ${theirs || 'none'}`}
                style={
                  large ? { gap: 2 } : { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }
                }
              >
                <CompactText
                  variant="small"
                  weight={large ? 'semibold' : undefined}
                  style={large ? undefined : { width: 84 }}
                >
                  {label}
                </CompactText>
                {value(field, mine, 'yours')}
                {value(field, theirs, 'saved')}
              </View>
              {onChoose && isMoneyField(field) ? (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
                  <CompactButton
                    label="Keep yours"
                    accessibilityLabel={`Keep your ${reviewNames[field]}`}
                    variant="text"
                    dense
                    onPress={() => onChoose(field, 'mine')}
                  />
                  <CompactButton
                    label="Use saved"
                    accessibilityLabel={`Use the saved ${reviewNames[field]}`}
                    variant="tonal"
                    dense
                    onPress={() => onChoose(field, 'saved')}
                  />
                </View>
              ) : null}
            </View>
          );
        })
      ) : (
        <CompactText tone="secondary" style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
          Your version matches the saved one.
        </CompactText>
      )}
      <View
        style={{
          marginTop: 6,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          padding: 14,
        }}
      >
        <CompactText variant="small" tone="secondary">
          {note}
        </CompactText>
      </View>
    </Card>
  );
}

/** Category and Notes behind one optional row. */
export const OptionalDetails = memo(function OptionalDetails({
  controller,
  draft,
  locked,
  categoryLocked = locked,
  onChange,
}: {
  controller?: MobileController;
  draft: Pick<ExpenseDraft, 'notes' | 'category'>;
  locked: boolean;
  categoryLocked?: boolean;
  onChange: (patch: Partial<ExpenseDraft>) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // A drag that starts on it never opens or closes it (#693).
  const tap = useTap();
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Category and notes, optional"
        accessibilityState={{ expanded: open }}
        {...tap.on(() => setOpen(!open))}
        style={({ pressed }) => ({
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 14,
          backgroundColor: pressed && !tap.dragged ? theme.surfaceMuted : undefined,
        })}
      >
        <Icon name="document-text-outline" size={20} color={theme.brand.main} />
        <CompactText weight="semibold" style={{ flex: 1 }}>
          Category and notes
        </CompactText>
        <FieldMarker kind="optional" />
        <Icon name={open ? 'chevron-up-outline' : 'chevron-down-outline'} size={20} />
      </Pressable>
      {open ? (
        <View style={{ padding: 14, paddingTop: 4, gap: 12 }}>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Category"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          >
            {EXPENSE_CATEGORIES.map((category) => (
              <Chip
                key={category.id}
                role="radio"
                label={category.label}
                selected={draft.category === category.id}
                disabled={categoryLocked}
                onPress={() => !categoryLocked && onChange({ category: category.id })}
              />
            ))}
          </View>
          {controller ? (
            <SelectedNotesField controller={controller} locked={locked} onChange={onChange} />
          ) : (
            <NotesField notes={draft.notes} locked={locked} onChange={onChange} />
          )}
        </View>
      ) : null}
    </Card>
  );
});

/** The bar pinned under a form, above the keyboard: its own surface, with a line along its top. */
export function ActionBar({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.bgElevated,
      }}
    >
      {children}
    </View>
  );
}

/**
 * Whether what's under Save sits beside it, in one row: Finish later lays itself out as the
 * row's start, with Save taking the rest (#646).
 */
export const SaveBarRow = createContext(false);

/**
 * What the box that keeps Add expense's footer at its tallest (#376) is told by Save: `release`
 * while the amount typed can't be saved, so Save names no amount and the line it took under
 * Save's words goes. The box then fits the bar rather than keep that line as an empty band above
 * it, as at 200% on a 360 dp phone over an amount past the maximum (#925). Written as Save lays
 * out, never read while rendering, so it draws nothing again.
 */
export const RetainedFooter = createContext<{ release: boolean } | null>(null);

/**
 * Outfit SemiBold's widths, taken as Regular's (`outfitWidth`) times this: Finish later measured
 * 115 dp wide on an emulator at 100%, 18 dp of padding each side.
 */
const SEMIBOLD = 1.08;

/**
 * How Save fits beside what goes in its row (#646), worked out from the widths of their words at
 * this text size: on one line with its amount; with the amount under its words, still beside it,
 * where both don't fit on one line ("Save expense ₹1,249.50" at 360 dp read "Save / expense");
 * or not at all, so the row stacks, where even its words don't fit (or their width isn't known).
 */
export function saveBeside({
  label,
  amount,
  beside,
  width,
  fontScale,
}: {
  label: string;
  amount?: string;
  /** The words of what sits beside Save, such as "Finish later". */
  beside: string;
  width: number;
  fontScale: number;
}): 'inline' | 'below' | 'stacked' {
  const size = scaledSp(15, fontScale);
  const [words, other] = [outfitWidth(label), outfitWidth(beside)];
  if (words === null || other === null) return 'stacked';
  // The bar's padding, the row's gap, the button beside Save and Save's own padding.
  const room = width - 2 * 16 - 8 - (other * SEMIBOLD * size + 2 * 18) - 2 * 18;
  const wordsWidth = words * SEMIBOLD * size;
  // The amount in the money face, as Android draws it (`moneyWidth`, #945).
  const money = amount ? moneyWidth(amount, 'list', fontScale) : 0;
  if (wordsWidth + (amount ? 8 + money : 0) <= room) return 'inline';
  if (amount && Math.max(wordsWidth, money) <= room) return 'below';
  return 'stacked';
}

/**
 * Pinned under the form, above the keyboard; it names the amount once that is valid. On a short
 * window (`useShortWindow`), what's under Save, such as Finish later, goes beside it in one row,
 * so the bar takes about 76 dp and the form keeps "Who owes what" in view at 360×640 (#646).
 * From 130% text the two don't fit side by side, so they stay stacked. Save's words never break:
 * an amount that doesn't fit beside them goes under them, and words that don't fit beside Finish
 * later stack the row (`saveBeside`).
 */
export function SaveBar({
  label,
  amount,
  busy,
  blocked,
  onSave,
  secondary,
  beside = 'Finish later',
  amountWrong = false,
  children,
}: {
  label: string;
  amount?: string;
  /** While saving, what Save says it's doing, beside a spinner, e.g. "Saving expense…". */
  busy?: string;
  /** Why Save is unavailable, also spoken as its hint. */
  blocked: string | null;
  onSave: () => void;
  /** A quieter alternative under the main action, such as "Keep for later". */
  secondary?: { label: string; onPress: () => void };
  /** More under Save, in the bar itself, such as Finish later and what it does. */
  children?: ReactNode;
  /** The words of what goes beside Save on a short window, to know whether both fit. */
  beside?: string;
  /** The amount typed can't be saved, so Save names none (`RetainedFooter`). */
  amountWrong?: boolean;
}) {
  const retained = useContext(RetainedFooter);
  useLayoutEffect(() => {
    if (retained) retained.release = amountWrong;
  });
  // From 150% the amount goes under the words: beside "CHF 2,500.50" at 200% on a 360 dp phone,
  // Save read "Save ex / pense" (#867), as Record payment's did (#639).
  const largest = useLargestText();
  const short = useShortWindow();
  const large = useLargeText();
  const { width, fontScale } = useWindowDimensions();
  const fit =
    short && !large && children ? saveBeside({ label, amount, beside, width, fontScale }) : null;
  const row = fit !== null && fit !== 'stacked';
  const save = (
    <CompactButton
      label={label}
      amount={amount}
      amountBelow={largest || fit === 'below'}
      busy={busy}
      block
      disabled={blocked !== null}
      hint={blocked ?? undefined}
      onPress={onSave}
    />
  );
  const other = secondary ? (
    <CompactButton label={secondary.label} variant="text" block onPress={secondary.onPress} />
  ) : null;
  return (
    <ActionBar>
      {/* Above Save: the bar grows upward from the bottom of the screen, so Save stays put. */}
      {/* Centred, as the notes under it are, such as what Finish later does offline (#646). */}
      {blocked ? (
        <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
          {blocked}
        </CompactText>
      ) : null}
      {row ? (
        <>
          {/* What goes beside Save starts the row; a note of its own takes a line above it. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 6 }}>
            <SaveBarRow.Provider value>{children}</SaveBarRow.Provider>
            <View style={{ flex: 1 }}>{save}</View>
          </View>
          {other}
        </>
      ) : (
        <>
          {save}
          {other}
          {children}
        </>
      )}
    </ActionBar>
  );
}
