'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import MoneyText from '@/components/common/MoneyText';
import { RADIUS } from '@/lib/theme/tokens';
import { getCurrency } from '@splitbook/shared/currency';
import {
  readStoredAmountMinor,
  readUnsupportedAmountMinor,
  toMajorAmount,
  unsupportedMajorAmount,
} from '@splitbook/shared/exact-money';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import { expensePayerSummary, listedExpensePosition } from '@splitbook/shared/expense-row';
import type {
  ExpenseTagChangeReply,
  ExpenseTagChangeResult,
} from '@splitbook/shared/expense-tag-change';
import type { ExpensePosition } from '@splitbook/shared/expense-position';
import { PositionText } from './expense-row-parts';
import { expenseDayLabel } from './ExpenseTable';

interface PanelTag {
  _id?: string;
  name: string;
  isArchived?: boolean;
  isDeleted?: boolean;
}

/** One Expense the change left as it was, and why, in member words. */
interface Miss {
  expenseId: string;
  description: string;
  reason: string;
}

const noun = (count: number) => (count === 1 ? 'Expense' : 'Expenses');

/** Why an Expense didn't change, by its outcome; a refusal says its own reason. */
function missReason(result: ExpenseTagChangeResult): string {
  if (result.outcome === 'changed-elsewhere')
    return 'Someone changed it a moment ago. Open it to see the latest.';
  if (result.outcome === 'unavailable') return 'It was deleted, or isn’t in this Group any more.';
  return result.reason ?? 'It couldn’t change.';
}

/** "Moved 2 Expenses to Household. 1 already was." for what changed and what already had. */
export function tagChangeSummary(results: readonly ExpenseTagChangeResult[], tagName: string) {
  const changed = results.filter((result) => result.outcome === 'changed').length;
  const already = results.filter((result) => result.outcome === 'unchanged').length;
  return [
    changed || !already ? `Moved ${changed} ${noun(changed)} to ${tagName}.` : '',
    already ? `${already} already ${already === 1 ? 'was' : 'were'} on ${tagName}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Every amount the Expenses add up to, one per currency, in exact minor units. A currency
 * Splitbook no longer supports adds its own, as stored, last (#810).
 */
function totals(expenses: readonly ExpenseRead[]) {
  const byCurrency = new Map<string, number>();
  for (const expense of expenses)
    byCurrency.set(
      expense.currency,
      (byCurrency.get(expense.currency) ?? 0) +
        (getCurrency(expense.currency)
          ? readStoredAmountMinor({
              currency: expense.currency,
              moneyVersion: expense.moneyVersion,
              amount: expense.amount,
              amountMinor: expense.amountMinor,
            })
          : readUnsupportedAmountMinor(expense)),
    );
  return [...byCurrency].sort(([a], [b]) => Number(!getCurrency(a)) - Number(!getCurrency(b)));
}

/** Minor units in major units, as stored for a currency Splitbook no longer supports (#810). */
const major = (minor: number, currency: string) =>
  getCurrency(currency) ? toMajorAmount(minor, currency) : unsupportedMajorAmount(minor);

/** What the Expenses mean for the member together, per currency: lent or owe, exactly. */
function positions(expenses: readonly ExpenseRead[], userId: string) {
  const net = new Map<string, number>();
  for (const expense of expenses) {
    const position = listedExpensePosition(expense, userId);
    const signed = !position
      ? 0
      : position.kind === 'lent'
        ? position.amountMinor
        : -position.amountMinor;
    net.set(expense.currency, (net.get(expense.currency) ?? 0) + signed);
  }
  return [...net].map(([currency, minor]): [string, ExpensePosition | null] => [
    currency,
    minor === 0
      ? null
      : {
          kind: minor > 0 ? 'lent' : 'owe',
          amountMinor: Math.abs(minor),
          amount: toMajorAmount(Math.abs(minor), currency),
        },
  ]);
}

/**
 * The selected Expenses, in place of the open one (#610, design canvas "GroupExpenses"): how
 * many, their total, each one, and the member's position on them, with Change Tag. Change Tag
 * offers the Group's active Tags; picking one moves every selected Expense to it in one request.
 * What didn't change is listed with why, each with Open. Export selected downloads them as a CSV
 * with each member's share (#613). There is no bulk Delete.
 */
export default function ExpenseSelectionPanel({
  expenses,
  userId,
  tags,
  onClear,
  onChangeTag,
  onOpen,
  onExport,
}: {
  /** The selected Expenses, in the list's order. */
  expenses: readonly ExpenseRead[];
  userId: string;
  /** The Group's Tags: only the active ones are offered. */
  tags: readonly PanelTag[];
  onClear: () => void;
  /** Send the change; rejects with what to tell the member when the request changed nothing. */
  onChangeTag: (tagId: string) => Promise<ExpenseTagChangeReply>;
  onOpen: (expenseId: string) => void;
  /** Download them as a CSV; resolves with the file's name, rejects with what to tell the member. */
  onExport?: () => Promise<string>;
}) {
  const [step, setStep] = useState<'idle' | 'choosing' | 'sending'>('idle');
  const [sendingTo, setSendingTo] = useState('');
  const [outcome, setOutcome] = useState<{ summary: string; misses: Miss[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [exported, setExported] = useState<
    | { status: 'preparing' }
    | { status: 'done'; fileName: string; count: number }
    | { status: 'failed'; message: string }
    | null
  >(null);
  const active = tags.filter(
    (tag): tag is PanelTag & { _id: string } =>
      Boolean(tag._id) && !tag.isArchived && !tag.isDeleted,
  );
  const count = expenses.length;
  // The Tag every selected Expense already has, if they share one: its choice says so.
  const shared = new Set(expenses.map((expense) => expense.tagId ?? null));
  const currentTagId = shared.size === 1 ? [...shared][0] : null;

  const change = async (tag: PanelTag & { _id: string }) => {
    const asked = new Map(expenses.map((expense) => [expense._id, expense.description]));
    setStep('sending');
    setSendingTo(tag.name);
    setOutcome(null);
    setFailure(null);
    // An earlier export's word no longer describes these Expenses; one still preparing stays.
    setExported((now) => (now?.status === 'preparing' ? now : null));
    try {
      const reply = await onChangeTag(tag._id);
      const misses = reply.results
        .filter((result) => result.outcome !== 'changed' && result.outcome !== 'unchanged')
        .map((result) => ({
          expenseId: result.expenseId,
          description: asked.get(result.expenseId) ?? 'An Expense',
          reason: missReason(result),
        }));
      setOutcome({ summary: tagChangeSummary(reply.results, tag.name), misses });
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Splitbook couldn’t change these Expenses.',
      );
    } finally {
      setStep('idle');
    }
  };

  const exportThem = async () => {
    if (!onExport || exported?.status === 'preparing') return;
    // How many went into the file, though the selection may change while it downloads.
    const exporting = count;
    setExported({ status: 'preparing' });
    try {
      setExported({ status: 'done', fileName: await onExport(), count: exporting });
    } catch (error) {
      setExported({
        status: 'failed',
        message: error instanceof Error ? error.message : 'The export couldn’t be prepared.',
      });
    }
  };

  return (
    <Box
      component="section"
      id="expense-selection"
      aria-labelledby="expense-selection-title"
      sx={{
        p: 2.5,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
      }}
    >
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={1}>
        <Typography id="expense-selection-title" component="h2" variant="h6">
          {count} selected ·{' '}
          {totals(expenses).map(([currency, minor], index) => (
            <Box component="span" key={currency}>
              {index > 0 ? ' + ' : ''}
              <MoneyText
                amount={major(minor, currency)}
                currency={currency}
                tone="neutral"
                sx={{ fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit' }}
              />
            </Box>
          ))}
        </Typography>
        <Button size="small" onClick={onClear} aria-label="Clear the selection">
          Clear
        </Button>
      </Stack>

      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.25 }}>
        {expenses.map((expense) => (
          <Box
            component="li"
            key={expense._id}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 1.5,
              py: 1.25,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600}>
                {expense.description}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {[
                  expenseDayLabel(expense.date),
                  expense.tag,
                  `${expensePayerSummary(expense, userId).label} paid`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            </Box>
            <MoneyText
              amount={expense.amount}
              currency={expense.currency}
              tone="neutral"
              variant="body2"
            />
          </Box>
        ))}
      </Box>

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}
      >
        <Typography variant="body2">Your position on these</Typography>
        <Stack alignItems="flex-end">
          {positions(expenses, userId).map(([currency, position]) => (
            <PositionText key={currency} position={position} currency={currency} />
          ))}
        </Stack>
      </Stack>

      {/* Each action's choices and report sit right under its own button. */}
      <Stack gap={1.25} sx={{ mt: 2 }}>
        <Button
          variant="outlined"
          fullWidth
          startIcon={<LocalOfferOutlinedIcon />}
          aria-expanded={step === 'choosing'}
          disabled={step === 'sending' || active.length === 0}
          onClick={() => setStep(step === 'choosing' ? 'idle' : 'choosing')}
        >
          Change Tag
        </Button>

        {step === 'choosing' && (
          <Box>
            <Typography
              id="expense-selection-move"
              variant="body2"
              color="text.secondary"
              sx={{ mb: 1 }}
            >
              Move {count} {noun(count)} to:
            </Typography>
            <Box
              role="group"
              aria-labelledby="expense-selection-move"
              sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
            >
              {active.map((tag) => {
                const current = tag._id === currentTagId;
                return (
                  <Button
                    key={tag._id}
                    size="small"
                    variant="outlined"
                    aria-label={`Move to ${tag.name}`}
                    aria-current={current ? 'true' : undefined}
                    startIcon={current ? <CheckIcon /> : undefined}
                    onClick={() => void change(tag)}
                    sx={{
                      borderRadius: 999,
                      textTransform: 'none',
                      fontWeight: 500,
                      color: current ? 'primary.main' : 'text.primary',
                      borderColor: current ? 'primary.main' : 'divider',
                      bgcolor: current ? 'tint.brand' : 'surface.muted',
                    }}
                  >
                    {tag.name}
                  </Button>
                );
              })}
              <Button size="small" onClick={() => setStep('idle')}>
                Cancel
              </Button>
            </Box>
          </Box>
        )}

        {step === 'sending' && (
          <Typography role="status" variant="body2">
            Moving {count} {noun(count)} to {sendingTo}…
          </Typography>
        )}

        {failure && (
          <Typography role="alert" variant="body2" color="error">
            {failure}
          </Typography>
        )}

        {outcome && (
          <Box role="status">
            <Typography variant="body2">
              {outcome.summary}
              {outcome.misses.length ? ` ${outcome.misses.length} didn’t change:` : ''}
            </Typography>
            {outcome.misses.length > 0 && (
              <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
                {outcome.misses.map((miss) => (
                  <Box
                    component="li"
                    key={miss.expenseId}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {miss.description}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {miss.reason}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      aria-label={`Open ${miss.description}`}
                      onClick={() => onOpen(miss.expenseId)}
                    >
                      Open
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        {onExport && (
          <Button
            variant="outlined"
            fullWidth
            startIcon={<IosShareOutlinedIcon />}
            disabled={exported?.status === 'preparing'}
            onClick={() => void exportThem()}
          >
            Export selected
          </Button>
        )}
        {exported?.status === 'preparing' && (
          <Typography role="status" variant="body2">
            Preparing the export…
          </Typography>
        )}
        {exported?.status === 'done' && (
          <Box role="status" sx={{ minWidth: 0 }}>
            <Typography variant="body2">
              Downloading {exported.count} {noun(exported.count)} as CSV
            </Typography>
            {/* The name stays on one line; the whole of it is in the title. */}
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              title={exported.fileName}
              sx={{ display: 'block' }}
            >
              {exported.fileName}
            </Typography>
          </Box>
        )}
        {exported?.status === 'failed' && (
          <Typography role="alert" variant="body2" color="error">
            {exported.message}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
