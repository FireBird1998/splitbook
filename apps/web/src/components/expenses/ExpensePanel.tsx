'use client';

import { useId, type ReactNode } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import { format } from 'date-fns';
import ErrorState from '@/components/common/ErrorState';
import MoneyText from '@/components/common/MoneyText';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { initials } from '@/components/layout/AccountMenu';
import { RADIUS } from '@/lib/theme/tokens';
import { getCategory } from '@splitbook/shared/categories';
import { formatDateTime } from '@splitbook/shared/date';
import { moneyParticipantId, toMajorAmount } from '@splitbook/shared/exact-money';
import {
  expenseHistory,
  expenseLeftover,
  expenseShareRows,
  leftoverNote,
  type RecordedEdit,
  type StoredExpenseSplit,
} from '@splitbook/shared/expense-detail';
import { expensePosition, expenseRecordPosition } from '@splitbook/shared/expense-position';
import { expenseSplitSummary } from '@splitbook/shared/expense-row';

/** An Expense as the list or its own read returns it; history comes from its own read. */
export interface PanelExpense extends StoredExpenseSplit {
  _id: string;
  description: string;
  date: string;
  createdAt: string;
  category: string;
  tag?: string;
  notes?: string;
  receiptUrl?: string | null;
  recurringExpense?: string | null;
  createdBy?: unknown;
  editHistory?: RecordedEdit[];
}

/** What the panel shows. */
export type ExpensePanelState =
  /** Nothing open. */
  | { kind: 'empty' }
  /** The open Expense was deleted, or the member can no longer read it. */
  | { kind: 'lost' }
  /** Opened from a link: its read is on its way. */
  | { kind: 'loading' }
  /** Opened from a link, and its read failed. */
  | { kind: 'failed' }
  | {
      kind: 'open';
      expense: PanelExpense;
      /** Whether the Expense's own read, with its history, has loaded, failed or is coming. */
      history: 'loading' | 'ready' | 'failed';
      /** The Repeats row, or null when it has none (or recurring Expenses are switched off). */
      repeats: string | null;
    };

interface ExpensePanelProps {
  /** The element id the open row's button controls. */
  id: string;
  state: ExpensePanelState;
  userId: string;
  /** Members' names by id, for anyone a read names by id alone. */
  names?: ReadonlyMap<string, string>;
  onClose: () => void;
  /** Read the open Expense again. */
  onRetry: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

const card = {
  bgcolor: 'background.paper',
  border: 1,
  borderColor: 'divider',
  borderRadius: `${RADIUS.lg}px`,
  minWidth: 0,
} as const;

const overline = {
  fontSize: '0.71875rem',
  lineHeight: 1.3,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'text.secondary',
} as const;

const caption = { fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' } as const;

const tile = {
  width: 36,
  height: 36,
  borderRadius: '11px',
  bgcolor: 'tint.brand',
  color: 'primary.main',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
} as const;

const divider = <Box aria-hidden sx={{ height: '1px', bgcolor: 'divider' }} />;

/** "Tue 29 Sep 2026": the Expense's day in the viewer's own time zone, as the table shows it. */
export function panelDay(date: string): string {
  return format(new Date(date), 'EEE d MMM yyyy');
}

/**
 * The side panel beside a Group's Expense table on a computer (#311, design canvas
 * "GroupExpenses"): the open Expense's amount and the member's position, Edit and Duplicate,
 * who paid and who owes what with any leftover explained, its Category, Notes, Repeats (only
 * while recurring Expenses are switched on) and history, and Delete. With nothing open it says
 * so quietly; when the open Expense has gone it says that instead.
 */
export default function ExpensePanel(props: ExpensePanelProps) {
  const { id, state, onClose } = props;
  if (state.kind === 'open') return <OpenExpense {...props} state={state} />;
  if (state.kind === 'empty')
    return (
      <Notice
        id={id}
        icon={<ReceiptLongOutlinedIcon sx={{ fontSize: 18 }} />}
        title="No Expense open"
      >
        Pick an Expense to see who owes what, its notes and its history.
      </Notice>
    );
  if (state.kind === 'lost')
    return (
      <Notice
        id={id}
        icon={<SearchOffOutlinedIcon sx={{ fontSize: 18 }} />}
        title="This Expense isn’t here any more"
        onClose={onClose}
        status
      >
        It was deleted, or it’s no longer in this Group. Pick another Expense to see its details.
      </Notice>
    );
  return (
    <Box component="section" id={id} aria-label="Expense details" sx={card}>
      <PanelHeader onClose={onClose} />
      <Box sx={{ px: '20px', pb: '20px' }}>
        {state.kind === 'failed' ? (
          <ErrorState
            message="This Expense could not be loaded."
            onRetry={props.onRetry}
            retryLabel="Try again"
          />
        ) : (
          <Box role="status" aria-label="Loading the Expense">
            <Box aria-hidden>
              <Skeleton variant="text" width="70%" height={32} />
              <Skeleton variant="text" width="40%" />
              <Skeleton variant="rounded" height={120} sx={{ mt: 2 }} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** The panel with nothing to show: nothing open, or the open Expense gone. */
function Notice({
  id,
  icon,
  title,
  children,
  onClose,
  status = false,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onClose?: () => void;
  status?: boolean;
}) {
  return (
    <Box
      component="section"
      id={id}
      aria-label="Expense details"
      // Focus lands here once the open Expense is deleted, so it isn't lost with its button.
      tabIndex={-1}
      sx={{ ...card, position: 'relative' }}
    >
      {onClose && (
        <IconButton
          aria-label="Close Expense details"
          onClick={onClose}
          sx={{ position: 'absolute', top: 8, right: 8, color: 'text.secondary' }}
        >
          <CloseIcon />
        </IconButton>
      )}
      <Box
        role={status ? 'status' : undefined}
        sx={{
          p: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '10px',
        }}
      >
        <Box aria-hidden sx={tile}>
          {icon}
        </Box>
        <Typography component="h2" sx={{ fontSize: '1rem', lineHeight: 1.3, fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: '0.8125rem', lineHeight: 1.4, color: 'text.secondary' }}>
          {children}
        </Typography>
      </Box>
    </Box>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        minHeight: 56,
        p: '6px 8px 0 20px',
      }}
    >
      <Typography component="span" sx={overline}>
        Expense
      </Typography>
      <IconButton
        aria-label="Close Expense details"
        onClick={onClose}
        sx={{ color: 'text.secondary' }}
      >
        <CloseIcon />
      </IconButton>
    </Box>
  );
}

/** A section's heading row: its name, and a note beside it. */
function SectionHeading({ id, title, note }: { id?: string; title: string; note: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 1,
        p: '14px 20px 4px',
      }}
    >
      <Typography id={id} component="h3" sx={overline}>
        {title}
      </Typography>
      <Typography component="span" sx={caption}>
        {note}
      </Typography>
    </Box>
  );
}

function PersonAvatar({ name }: { name: string | null }) {
  return (
    <Avatar
      aria-hidden
      sx={{
        width: 26,
        height: 26,
        borderRadius: '9px',
        bgcolor: 'tint.brand',
        color: 'primary.main',
        fontSize: '0.65625rem',
        fontWeight: 600,
        flex: 'none',
      }}
    >
      {name ? initials(name) : '?'}
    </Avatar>
  );
}

function OpenExpense({
  id,
  state,
  userId,
  names = new Map(),
  onClose,
  onRetry,
  onEdit,
  onDuplicate,
  onDelete,
}: ExpensePanelProps & { state: Extract<ExpensePanelState, { kind: 'open' }> }) {
  const owesId = useId();
  const { expense, history, repeats } = state;
  const currency = expense.currency;

  /** A person's name, with the viewer as "You"; null for a former member. */
  const nameOf = (person: unknown): string | null => {
    const personId = moneyParticipantId(person);
    if (!personId) return null;
    const named =
      typeof person === 'object' && person && 'name' in person && typeof person.name === 'string'
        ? person.name
        : null;
    return named ?? names.get(personId) ?? null;
  };
  const label = (person: unknown) =>
    moneyParticipantId(person) === userId ? 'You' : (nameOf(person) ?? 'Former member');

  const rows = expenseShareRows(expense);
  const leftover = rows ? expenseLeftover(expense) : null;
  const byId = new Map(rows?.flatMap((row) => (row.userId ? [[row.userId, row.user]] : [])));
  const note = leftover
    ? leftoverNote(leftover, currency, (personId) =>
        personId === userId ? 'you' : (nameOf(byId.get(personId) ?? personId) ?? 'a former member'),
      )
    : null;
  const category = getCategory(expense.category);
  const meta = [panelDay(expense.date), expense.tag].filter(Boolean).join(' · ');

  return (
    <Box component="section" id={id} aria-label={`${expense.description} details`} sx={card}>
      <PanelHeader onClose={onClose} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px', p: '4px 20px 18px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <Box aria-hidden sx={{ ...tile, fontSize: '1.125rem' }}>
            {category?.icon ?? '📋'}
          </Box>
          <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <Typography
              component="h2"
              sx={{
                fontSize: '1.375rem',
                lineHeight: 1.2,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                overflowWrap: 'anywhere',
              }}
            >
              {expense.description}
            </Typography>
            <Typography component="p" sx={caption}>
              {meta}
            </Typography>
          </Box>
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px 12px',
          }}
        >
          <MoneyText
            amount={expense.amount}
            currency={currency}
            tone="neutral"
            sx={{ fontSize: '1.75rem', lineHeight: 1.1, letterSpacing: '-0.03em' }}
          />
          {rows && <PositionBadge expense={expense} rows={rows} userId={userId} label={label} />}
        </Box>

        {(onEdit || onDuplicate) && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {onEdit && (
              <Button
                onClick={onEdit}
                startIcon={<EditOutlinedIcon />}
                sx={{
                  px: 2,
                  bgcolor: 'tint.brand',
                  color: 'primary.main',
                  '&:hover': { bgcolor: 'tint.brand', boxShadow: 'inset 0 0 0 1px currentColor' },
                }}
              >
                Edit
              </Button>
            )}
            {onDuplicate && (
              <Button
                variant="outlined"
                onClick={onDuplicate}
                startIcon={<ContentCopyOutlinedIcon />}
                sx={{
                  px: 2,
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  borderColor: 'border.strong',
                  '&:hover': { bgcolor: 'surface.hover', borderColor: 'border.strong' },
                }}
              >
                Duplicate
              </Button>
            )}
          </Box>
        )}
      </Box>

      {divider}
      <SectionHeading id={owesId} title="Who owes what" note={expenseSplitSummary(expense)} />
      {rows ? (
        <WhoOwesWhat
          labelledBy={owesId}
          rows={rows}
          currency={currency}
          label={label}
          nameOf={nameOf}
        />
      ) : (
        <Typography sx={{ ...caption, px: '20px', py: 1 }}>
          These amounts can’t be shown exactly.
        </Typography>
      )}
      {note && (
        <Typography component="p" sx={{ ...caption, p: '4px 20px 0' }}>
          {note}
        </Typography>
      )}
      <Box sx={{ height: 14 }} />

      {divider}
      <Box component="dl" sx={{ m: 0 }}>
        <Field term="Category">{category?.label ?? expense.category}</Field>
        {!!expense.notes && (
          <Field term="Notes" ruled>
            <Box component="span" sx={{ whiteSpace: 'pre-wrap' }}>
              {expense.notes}
            </Box>
          </Field>
        )}
        {repeats && (
          <Field term="Repeats" ruled>
            {repeats}
          </Field>
        )}
        {!!expense.receiptUrl && (
          <Field term="Receipt" ruled>
            <Box
              component="a"
              href={expense.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: 'primary.main' }}
            >
              View receipt
            </Box>
          </Field>
        )}
      </Box>

      {divider}
      <SectionHeading title="History" note="Edits keep a record" />
      <History
        expense={expense}
        state={history}
        onRetry={onRetry}
        label={label}
        nameOf={nameOf}
        userId={userId}
      />

      {onDelete && (
        <>
          <Box aria-hidden sx={{ height: '1px', bgcolor: 'divider', mt: '6px' }} />
          <Box sx={{ p: '12px 20px 16px' }}>
            <Button
              variant="outlined"
              onClick={onDelete}
              startIcon={<DeleteOutlineIcon />}
              sx={{
                px: 2,
                color: 'status.negative',
                borderColor: 'border.strong',
                '&:hover': { bgcolor: 'tint.negative', borderColor: 'border.strong' },
              }}
            >
              Delete Expense
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}

/**
 * What the Expense means for the member, from the shared `expensePosition`: "You lent ₹1,906.67"
 * or "You owe Sam Chen ₹953.33" (naming the one person on the other side when there is one).
 */
function PositionBadge({
  expense,
  rows,
  userId,
  label,
}: {
  expense: PanelExpense;
  rows: NonNullable<ReturnType<typeof expenseShareRows>>;
  userId: string;
  label: (person: unknown) => string;
}) {
  const parts = (part: 'paidMinor' | 'shareMinor') =>
    rows.map((row) => ({ userId: row.userId, amountMinor: row[part] }));
  let position: ReturnType<typeof expensePosition>;
  try {
    position = expensePosition(
      { currency: expense.currency, paidBy: parts('paidMinor'), splitBetween: parts('shareMinor') },
      userId,
    );
  } catch {
    return null;
  }
  const record = expenseRecordPosition(
    {
      paidBy: rows.map((row) => ({ user: row.userId, amountMinor: row.paidMinor })),
      splitBetween: rows.map((row) => ({ user: row.userId, amountMinor: row.shareMinor })),
    },
    userId,
  );
  const tone =
    position?.kind === 'lent' ? 'positive' : position?.kind === 'owe' ? 'negative' : null;
  const counterparty = rows.find((row) => row.userId && row.userId === record.counterpartyId);
  const lead = !position
    ? record.kind === 'even'
      ? 'You paid your share'
      : 'You’re not part of it'
    : position.kind === 'lent'
      ? 'You lent'
      : counterparty
        ? `You owe ${label(counterparty.user)}`
        : 'You owe';
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '6px',
        fontSize: '0.75rem',
        fontWeight: 600,
        borderRadius: '999px',
        px: '9px',
        py: '2px',
        whiteSpace: 'nowrap',
        bgcolor: tone ? `tint.${tone}` : 'surface.muted',
        color: tone ? `status.${tone}` : 'text.secondary',
      }}
    >
      {lead}
      {position && (
        <MoneyText
          amount={position.amount}
          currency={expense.currency}
          color="inherit"
          sx={{ fontSize: '0.75rem', fontWeight: 600 }}
        />
      )}
    </Box>
  );
}

/** Each person's Paid and Share, exactly, as a table a screen reader can walk. */
function WhoOwesWhat({
  labelledBy,
  rows,
  currency,
  label,
  nameOf,
}: {
  labelledBy: string;
  rows: NonNullable<ReturnType<typeof expenseShareRows>>;
  currency: string;
  label: (person: unknown) => string;
  nameOf: (person: unknown) => string | null;
}) {
  const cell = { px: 0, py: 0, height: 44, fontWeight: 400, verticalAlign: 'middle' } as const;
  const amount = (minor: number) => (
    <MoneyText
      amount={toMajorAmount(minor, currency)}
      currency={currency}
      tone="neutral"
      sx={{ fontSize: '0.78125rem' }}
    />
  );
  return (
    <Box sx={{ px: '20px' }}>
      <Box
        component="table"
        aria-labelledby={labelledBy}
        sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}
      >
        <thead>
          <tr>
            <Box component="th" scope="col" sx={{ ...cell, height: 24, textAlign: 'left' }}>
              <Box component="span" sx={visuallyHidden}>
                Person
              </Box>
            </Box>
            {['Paid', 'Share'].map((column) => (
              <Box
                component="th"
                key={column}
                scope="col"
                sx={{
                  ...cell,
                  ...caption,
                  height: 24,
                  width: column === 'Paid' ? 86 : 82,
                  textAlign: 'right',
                }}
              >
                {column}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.userId ?? `former-${index}`}>
              <Box component="th" scope="row" sx={{ ...cell, textAlign: 'left' }}>
                <Box
                  component="span"
                  sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}
                >
                  <PersonAvatar name={nameOf(row.user)} />
                  <Box
                    component="span"
                    sx={{
                      fontSize: '0.875rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label(row.user)}
                  </Box>
                </Box>
              </Box>
              <Box component="td" sx={{ ...cell, textAlign: 'right' }}>
                {row.paidMinor > 0 ? (
                  amount(row.paidMinor)
                ) : (
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    <span aria-hidden>–</span>
                    <Box component="span" sx={visuallyHidden}>
                      nothing
                    </Box>
                  </Box>
                )}
              </Box>
              <Box component="td" sx={{ ...cell, textAlign: 'right' }}>
                {amount(row.shareMinor)}
              </Box>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

/** A Category, Notes or Repeats row; `ruled` draws the line above it. */
function Field({
  term,
  ruled = false,
  children,
}: {
  term: string;
  ruled?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          p: '12px 20px',
          minHeight: 44,
          // The line sits inside the dl's group, which may hold only its dt and dd.
          ...(ruled && {
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 20,
              right: 20,
              height: '1px',
              bgcolor: 'divider',
            },
          }),
        }}
      >
        <Typography
          component="dt"
          sx={{ fontSize: '0.8125rem', color: 'text.secondary', flex: 'none' }}
        >
          {term}
        </Typography>
        <Typography
          component="dd"
          sx={{
            m: 0,
            fontSize: '0.875rem',
            lineHeight: 1.45,
            textAlign: 'right',
            overflowWrap: 'anywhere',
          }}
        >
          {children}
        </Typography>
      </Box>
    </>
  );
}

/** Who added the Expense and every recorded edit, newest first, from its own read. */
function History({
  expense,
  state,
  onRetry,
  label,
  nameOf,
  userId,
}: {
  expense: PanelExpense;
  state: 'loading' | 'ready' | 'failed';
  onRetry: () => void;
  label: (person: unknown) => string;
  nameOf: (person: unknown) => string | null;
  userId: string;
}) {
  if (state === 'failed')
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: '6px 20px 10px' }}>
        <Typography role="alert" sx={{ fontSize: '0.8125rem', color: 'status.negative' }}>
          This Expense’s history could not be loaded.
        </Typography>
        <Button size="small" onClick={onRetry}>
          Try again
        </Button>
      </Box>
    );
  if (state === 'loading')
    return (
      <Typography role="status" sx={{ ...caption, p: '6px 20px 10px' }}>
        Loading its history…
      </Typography>
    );
  const entries = expenseHistory(expense);
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {entries.map((entry, index) => {
        const { change } = entry;
        const you = moneyParticipantId(entry.by) === userId;
        return (
          <Box
            component="li"
            key={`${entry.at}-${index}`}
            sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px', p: '10px 20px' }}
          >
            <PersonAvatar name={nameOf(entry.by) ?? (you ? 'You' : null)} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {label(entry.by)}
                </Box>{' '}
                {entry.action}
              </Typography>
              <Typography sx={{ ...caption, overflowWrap: 'anywhere' }}>
                {change && (
                  <Box
                    component="span"
                    sx={change.kind === 'amount' ? (theme) => theme.typography.money : undefined}
                  >
                    {change.before} → {change.after}
                  </Box>
                )}
                {change && ' · '}
                {formatDateTime(entry.at)}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
