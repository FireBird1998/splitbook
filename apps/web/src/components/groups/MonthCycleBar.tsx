'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth } from 'date-fns';
import MoneyText from '@/components/common/MoneyText';
import ExpenseStats, { StatCount } from '@/components/expenses/ExpenseStats';
import { RADIUS } from '@/lib/theme/tokens';

const MONTH_PARAM_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The active month of a Household group view, derived from the `?month=YYYY-MM`
 * search param. Absent (or malformed) means "all time". Bounds are full ISO
 * 8601 timestamps computed in the viewer's timezone — an IST viewer's August
 * ends `2026-08-31T18:29:59.999Z` — so the service respects them as-is.
 */
export interface ActiveMonthRange {
  /** `YYYY-MM` param value, e.g. "2026-08". */
  key: string;
  /** Inclusive window start, ISO 8601 with offset (`2026-08-01T00:00:00.000+05:30`-style Z form). */
  dateFrom: string;
  /** Inclusive window end, ISO 8601. */
  dateTo: string;
  /** Display label, e.g. "August 2026". */
  label: string;
  /** Short month name for prompts, e.g. "August". */
  monthName: string;
  /** True when the active month is the viewer's current calendar month. */
  isCurrentMonth: boolean;
  /** Last day of the month (viewer-local), for the expense form date default. */
  lastDay: Date;
}

/** The Month's figures for the member (#310): what was spent, their share and what they Paid. */
export interface MonthSummary {
  spent: number;
  share: number;
  paid: number;
  count: number;
}

interface MonthCycleBarProps {
  currency: string;
  /** The Month's figures; null while they load. */
  summary: MonthSummary | null;
  /** The figures could not be loaded. */
  failed?: boolean;
  onRetry?: () => void;
}

export function parseMonthParam(
  raw: string | null,
  now: Date = new Date(),
): ActiveMonthRange | null {
  if (!raw || !MONTH_PARAM_PATTERN.test(raw)) return null;
  const [year, month] = raw.split('-').map(Number);
  const anchor = new Date(year, month - 1, 1);
  if (Number.isNaN(anchor.getTime())) return null;

  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  return {
    key: raw,
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
    label: format(anchor, 'MMMM yyyy'),
    monthName: format(anchor, 'MMMM'),
    isCurrentMonth: isSameMonth(anchor, now),
    lastDay: end,
  };
}

/**
 * A Household's Month bar (#310, design canvas "GroupExpenses"): step through Months, jump to
 * this Month or All time, and read the Month's figures, Spent, Your share, You paid and
 * Expenses. A Month is a read-only lens in the viewer's own time zone, never a ledger boundary,
 * so it owns only `?month=YYYY-MM` (none is All time). Its figures are the whole Month's: the
 * search and filters below narrow the list, not the Month.
 */
export default function MonthCycleBar({ currency, summary, failed, onRetry }: MonthCycleBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active = useMemo(() => parseMonthParam(searchParams.get('month')), [searchParams]);
  const now = new Date();
  const viewingCurrent = active?.isCurrentMonth ?? false;

  const setMonthParam = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set('month', value);
      } else {
        params.delete('month');
      }
      // Another Month's list starts from its first page.
      params.delete('page');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const base = active ? new Date(`${active.key}-02T00:00:00`) : startOfMonth(now);
  const previous = addMonths(base, -1);
  const next = addMonths(base, 1);
  const canStepForward = active ? !viewingCurrent : false;
  const label = active ? active.label : 'All time';

  const money = (amount: number) => (
    <MoneyText
      amount={amount}
      currency={currency}
      tone="neutral"
      variant="body2"
      sx={{ fontSize: '0.875rem', lineHeight: 1.3 }}
    />
  );

  return (
    <Box
      component="section"
      aria-label={`${label} summary`}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '10px 20px',
        py: '10px',
        pl: 1,
        pr: '20px',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <IconButton
          onClick={() => setMonthParam(format(previous, 'yyyy-MM'))}
          aria-label={`Previous month, ${format(previous, 'MMMM yyyy')}`}
          sx={{ width: 44, height: 44 }}
        >
          <ChevronLeftIcon />
        </IconButton>
        <Typography
          component="h2"
          sx={{
            fontSize: '1rem',
            lineHeight: 1.3,
            fontWeight: 600,
            minWidth: { xs: 120, sm: 148 },
            textAlign: 'center',
          }}
        >
          {label}
        </Typography>
        <IconButton
          onClick={canStepForward ? () => setMonthParam(format(next, 'yyyy-MM')) : undefined}
          aria-disabled={!canStepForward}
          aria-label={
            canStepForward
              ? `Next month, ${format(next, 'MMMM yyyy')}`
              : active
                ? `Next month, unavailable: ${active.monthName} is the current month`
                : 'Next month, unavailable while showing all time'
          }
          sx={{
            width: 44,
            height: 44,
            '&[aria-disabled="true"]': {
              opacity: 0.4,
              cursor: 'default',
              '&:hover': { bgcolor: 'transparent' },
            },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Box>

      <Box
        role="group"
        aria-label="Period"
        sx={{
          display: 'inline-flex',
          gap: '3px',
          p: '3px',
          borderRadius: '12px',
          bgcolor: 'surface.muted',
        }}
      >
        {[
          {
            text: 'This month',
            pressed: viewingCurrent,
            go: () => setMonthParam(format(now, 'yyyy-MM')),
          },
          { text: 'All time', pressed: !active, go: () => setMonthParam(null) },
        ].map(({ text, pressed, go }) => (
          <Button
            key={text}
            aria-pressed={pressed}
            onClick={pressed ? undefined : go}
            sx={{
              minHeight: 38,
              px: '14px',
              borderRadius: '9px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: pressed ? 'text.primary' : 'text.secondary',
              bgcolor: pressed ? 'background.paper' : 'transparent',
              boxShadow: pressed ? 1 : 'none',
              '&:hover': { bgcolor: pressed ? 'background.paper' : 'surface.hover' },
            }}
          >
            {text}
          </Button>
        ))}
      </Box>

      <Box sx={{ flex: '1 1 auto' }} />

      {failed ? (
        <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ color: 'status.negative' }}>
            {label}’s figures could not be loaded.
          </Typography>
          {onRetry && (
            <Button size="small" onClick={onRetry}>
              Try again
            </Button>
          )}
        </Box>
      ) : (
        <ExpenseStats
          stats={[
            { term: 'Spent', value: summary && money(summary.spent) },
            { term: 'Your share', value: summary && money(summary.share) },
            { term: 'You paid', value: summary && money(summary.paid) },
            { term: 'Expenses', value: summary && <StatCount value={summary.count} /> },
          ]}
        />
      )}
    </Box>
  );
}
