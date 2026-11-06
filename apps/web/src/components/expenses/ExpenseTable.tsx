'use client';
import PreparedBy from './PreparedBy';

import { Fragment } from 'react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import type { Theme } from '@mui/material/styles';
import { format } from 'date-fns';
import MoneyText from '@/components/common/MoneyText';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { RADIUS, TOPBAR_HEIGHT } from '@/lib/theme/tokens';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import {
  expensePayerSummary,
  expenseSplitSummary,
  listedExpensePosition,
} from '@splitbook/shared/expense-row';
import { ExpenseTag, PayerLabel, PositionText, RepeatsIcon } from './expense-row-parts';
import TripDayRow from './TripDayRow';
import { useExpenseTableKeys } from './expense-table-keys';
import type { ExpenseSelection } from './expense-selection';
import type { TripDayHeading } from './expense-trip-days';
import { expenseLocalDate } from '@splitbook/shared/expense-day';
import { counted } from '@splitbook/shared/separator';

/** The table's columns, as the design canvas ("GroupExpenses") lays them out. */
export const EXPENSE_TABLE_COLUMNS = [
  'Date',
  'Description',
  'Paid by',
  'Split',
  'Amount',
  'You',
] as const;

/** A row's checkbox names its Expense and day: "Select Weekly groceries, 30 September" (#610). */
const selectLabel = (expense: ExpenseRead) =>
  `Select ${expense.description}, ${format(expenseLocalDate(expense.date), 'd MMMM')}`;

/** "Wed 30 Sep", with the year when it isn't this year's: the day it is dated, in every zone (#437). */
export function expenseDayLabel(date: string, now: Date = new Date()): string {
  const day = expenseLocalDate(date);
  return format(day, day.getFullYear() === now.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

interface ExpenseTableProps {
  expenses: ExpenseRead[];
  userId: string;
  /** Repeat icons show only while recurring Expenses are switched on (#289). */
  recurringExpensesEnabled: boolean;
  /** The section's name, e.g. "Expenses, September 2026". */
  label: string;
  /** Read before the table: what it lists and in which order. */
  caption: string;
  /** The Expense open in the side panel. */
  openId: string | null;
  onToggle: (expenseId: string) => void;
  /** Edit the focused Expense while the table has focus (#322). */
  onEdit?: (expenseId: string) => void;
  /** The side panel's element, which the open row's button controls (#311). */
  panelId: string;
  /** Dim the rows while a newer page loads. */
  stale?: boolean;
  /**
   * A Trip's day headings (#316), keyed by the id of each day's first Expense: a heading row
   * with the day's total goes above it. Heading rows open nothing.
   */
  dayHeadings?: ReadonlyMap<string, TripDayHeading> | null;
  /**
   * The Expenses ticked for a change to all of them (#610): each row gets a checkbox, the
   * header one for every row shown. While some are ticked, a click on a row ticks it too.
   */
  selection?: Pick<ExpenseSelection, 'selected' | 'onSelect' | 'onSelectAll'>;
}

/**
 * A cell: 5 px each side, so 10 px between columns. Beside the side panel on a 1280 px screen
 * the demo Trip's columns then fit with room to spare on macOS and Linux alike, whose fonts
 * draw a little wider (#900).
 */
const cell = {
  px: '5px',
  py: '6px',
  height: 56,
  borderBottom: 1,
  borderColor: 'divider',
  verticalAlign: 'middle',
  '&:first-of-type': { pl: '20px' },
  '&:last-of-type': { pr: '20px' },
} as const;

/**
 * The checkbox column, as narrow as its checkbox: MUI's small one, a 20 px box, here in 4 px
 * of padding (a 28 px target), the box 20 px in from the card's edge like the day headings'
 * words (#900).
 */
const checkboxCell = { ...cell, width: 16 + 28, pr: 0, '&:first-of-type': { pl: '16px' } } as const;
const checkboxSx = { p: '4px' } as const;

/**
 * Where the table is narrower than this, as beside the side panel on a 1280 px screen, four
 * cells put their parts one above the other, so every column fits and no figure is cut: the You
 * column puts "lent" or "owe" above its figure (#900), the Date its weekday above the day, Paid
 * by the payer's initials above their name, and Amount and You a currency code above its figure,
 * "CHF" over "10,000,000.00" and "owe CHF" over "5,000,000.00" (#942). A symbol stays with its
 * figure ("₹621.50"). Wider, each shares a line. Each row of a table reads the same way, and
 * each cell reads as before: "Wed 30 Sep", "CHF 10,000,000.00".
 *
 * These gave way because nothing else can: a split ("By percentage · 2"), a figure and each word
 * of a name stay whole, and a long name already wraps between its words and after a hyphen, as
 * on the statement (#928). Beside its initials, "Priyamvada Venkataraghavan-Subramaniam" made
 * Paid by 161 px and the table 665 px in a 626 px card; two Expenses of CHF 10,000,000.00 made
 * it 673 px, as Amount and You were each as wide as "CHF 10,000,000.00"; both together, 713 px.
 */
const STACKED = '@container expense-table (max-width: 759.98px)';

/** One part of a stacked cell: on its own line in a narrow table, in line in a wide one. */
const stackedLine = { [STACKED]: { display: 'block' } } as const;

/**
 * The table's scroll box, named so a cell can ask whether there is more of the table to its
 * right (#942).
 */
const SCROLL_BOX = 'expense-table-scroll';

/**
 * The You column: where the columns need more than the card, as with a long name, a split
 * "By percentage" and CHF 10,000,000.00 all at once (652 px of 624 stacked beside the side
 * panel at 1280, 802 px of 784 on one line at 1440), the table scrolls, and You stays at the
 * card's right edge with its figures whole while the other columns pass under it (#942). An
 * edge shows while one is under it, where the browser can tell (scroll-state queries). Sticky
 * moves the cell only once it would pass the card's edge, so a table that fits, as almost
 * always, lays out exactly as before: the card's colour under it is the card's own.
 */
const pinnedYou = {
  position: 'sticky',
  right: 0,
  zIndex: 1,
  bgcolor: 'background.paper',
  [`@container ${SCROLL_BOX} scroll-state(scrollable: right)`]: {
    boxShadow: (theme: Theme) => `inset 1px 0 0 ${theme.palette.divider}`,
  },
} as const;

/** "Wed 30 Sep": in a narrow table "Wed" above "30 Sep", still read as one date (#942). */
function DayLabel({ label }: { label: string }) {
  const [weekday, ...day] = label.split(' ');
  return (
    <>
      <Box component="span" sx={stackedLine}>
        {weekday}
      </Box>{' '}
      <Box component="span" sx={stackedLine}>
        {day.join(' ')}
      </Box>
    </>
  );
}

/**
 * A Group's Expenses on a computer (#310, design canvas "GroupExpenses"): the date, the
 * description with its Tag (and a repeat icon while recurring Expenses are on), who paid, how
 * it is split, the amount and the member's position. Each row's description is a button that
 * opens the Expense in the side panel beside the table (#311), and closes it again; a click
 * anywhere on the row does the same. The row itself is not a control, so no control sits
 * inside another.
 */
export default function ExpenseTable({
  expenses,
  userId,
  recurringExpensesEnabled,
  label,
  caption,
  openId,
  onToggle,
  panelId,
  stale = false,
  dayHeadings = null,
  onEdit,
  selection,
}: ExpenseTableProps) {
  const now = new Date();
  const onKeyDown = useExpenseTableKeys({ openId, onEdit, onSelect: selection?.onSelect });
  const ticked = selection ? expenses.filter((expense) => selection.selected.has(expense._id)) : [];
  const selecting = ticked.length > 0;
  // A click on the checkbox ticks it, and never opens the row too.
  const keepToCheckbox = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <Box
      component="section"
      aria-label={label}
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
        overflow: 'hidden',
        minWidth: 0,
        container: 'expense-table / inline-size',
      }}
    >
      {/* Positioned, so the cells' visually hidden "you" is clipped here with its cell and
          never widens the page (#944). */}
      <Box
        sx={{
          position: 'relative',
          overflowX: 'auto',
          containerName: SCROLL_BOX,
          containerType: 'scroll-state',
        }}
      >
        <Box
          component="table"
          onKeyDown={onKeyDown}
          sx={{
            width: '100%',
            // Beside the side panel (#311) a 1280 px screen leaves the table about 630 px, so
            // who paid may wrap there, and the Date, Paid by and You columns stack (#900, #942);
            // money and splits never wrap. Narrower still, the table scrolls inside its card.
            minWidth: 600,
            borderCollapse: 'collapse',
            fontSize: '0.875rem',
            transition: 'opacity 0.2s',
            opacity: stale ? 0.6 : 1,
            // The card draws the last line.
            '& > tbody > tr:last-of-type > td': { borderBottom: 0 },
          }}
        >
          <Box component="caption" sx={visuallyHidden}>
            {caption}
          </Box>
          <thead>
            <tr>
              {selection && (
                <Box component="th" scope="col" sx={{ ...checkboxCell, height: 'auto', py: '4px' }}>
                  <Checkbox
                    size="small"
                    sx={checkboxSx}
                    checked={selecting && ticked.length === expenses.length}
                    indeterminate={selecting && ticked.length < expenses.length}
                    onChange={() => selection.onSelectAll()}
                    slotProps={{
                      input: {
                        'aria-label': `Select all ${counted(expenses.length, 'Expense')}`,
                      },
                    }}
                  />
                </Box>
              )}
              {EXPENSE_TABLE_COLUMNS.map((column) => (
                <Box
                  component="th"
                  key={column}
                  scope="col"
                  sx={{
                    ...cell,
                    height: 'auto',
                    py: '10px',
                    textAlign: column === 'Amount' || column === 'You' ? 'right' : 'left',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'text.secondary',
                    whiteSpace: 'nowrap',
                    ...(column === 'You' ? pinnedYou : {}),
                  }}
                >
                  {column}
                </Box>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => {
              const open = expense._id === openId;
              const chosen = Boolean(selection?.selected.has(expense._id));
              const repeats = recurringExpensesEnabled && Boolean(expense.recurringExpense);
              const heading = dayHeadings?.get(expense._id);
              return (
                <Fragment key={expense._id}>
                  {heading ? (
                    <TripDayRow
                      heading={heading}
                      columns={EXPENSE_TABLE_COLUMNS.length + (selection ? 1 : 0)}
                    />
                  ) : null}
                  <Box
                    component="tr"
                    data-expense-id={expense._id}
                    onClick={() =>
                      selecting ? selection!.onSelect(expense._id) : onToggle(expense._id)
                    }
                    sx={{
                      cursor: 'pointer',
                      '& > td': { bgcolor: open || chosen ? 'tint.brand' : undefined },
                      '&:hover > td': { bgcolor: open || chosen ? 'tint.brand' : 'surface.hover' },
                      '&:has(button:focus-visible) > td': {
                        bgcolor: open || chosen ? 'tint.brand' : 'surface.hover',
                      },
                    }}
                  >
                    {selection && (
                      <Box component="td" sx={checkboxCell}>
                        <Checkbox
                          size="small"
                          sx={checkboxSx}
                          checked={chosen}
                          onClick={keepToCheckbox}
                          onChange={() => selection.onSelect(expense._id)}
                          slotProps={{ input: { 'aria-label': selectLabel(expense) } }}
                        />
                      </Box>
                    )}
                    <Box
                      component="td"
                      sx={{
                        ...cell,
                        whiteSpace: 'nowrap',
                        fontSize: '0.8125rem',
                        color: 'text.secondary',
                      }}
                    >
                      <DayLabel label={expenseDayLabel(expense.date, now)} />
                    </Box>
                    <Box component="td" sx={cell}>
                      {/* The row's click opens it; the button is how a keyboard does. */}
                      <Box
                        component="button"
                        type="button"
                        aria-expanded={open}
                        aria-controls={open ? panelId : undefined}
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          justifyContent: 'center',
                          gap: '3px',
                          minHeight: 44,
                          p: 0,
                          border: 0,
                          bgcolor: 'transparent',
                          textAlign: 'left',
                          color: 'text.primary',
                          font: 'inherit',
                          cursor: 'pointer',
                          // Keep the focused row clear of the sticky top bar.
                          scrollMarginTop: TOPBAR_HEIGHT + 16,
                          scrollMarginBottom: 16,
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontWeight: 600,
                          }}
                        >
                          {expense.description}
                          {repeats && <RepeatsIcon />}
                        </Box>
                        {expense.tag && <ExpenseTag name={expense.tag} />}
                      </Box>
                    </Box>
                    <Box component="td" sx={cell}>
                      <PayerLabel
                        payer={expensePayerSummary(expense, userId)}
                        sx={{
                          [STACKED]: {
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: '2px',
                          },
                        }}
                      />
                      <PreparedBy value={expense.preparedBy} inline />
                    </Box>
                    <Box
                      component="td"
                      sx={{ ...cell, fontSize: '0.8125rem', color: 'text.secondary' }}
                    >
                      {expenseSplitSummary(expense)}
                    </Box>
                    <Box component="td" sx={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <MoneyText
                        amount={expense.amount}
                        currency={expense.currency}
                        tone="neutral"
                        variant="body2"
                        figureSx={stackedLine}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cell, textAlign: 'right', ...pinnedYou }}>
                      <PositionText
                        position={listedExpensePosition(expense, userId)}
                        currency={expense.currency}
                        sx={stackedLine}
                        figureSx={stackedLine}
                      />
                    </Box>
                  </Box>
                </Fragment>
              );
            })}
          </tbody>
        </Box>
      </Box>
    </Box>
  );
}
