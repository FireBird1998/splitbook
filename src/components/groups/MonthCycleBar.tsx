'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth } from 'date-fns';
import MoneyText from '@/components/common/MoneyText';

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

interface MonthCycleBarProps {
  /** Summary for the active month — omitted while the first fetch is in flight. */
  summary?: { totalAmount: number; count: number; userFronted: number } | null;
  currency: string;
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
 * Month switcher for Household groups — a read-only lens over one calendar
 * month of expenses in the viewer's timezone. Owns the `?month=YYYY-MM` URL
 * param: ‹ › step months (forward capped at the current month), "This month"
 * jumps back, "All time" clears the param.
 */
export default function MonthCycleBar({ summary, currency }: MonthCycleBarProps) {
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
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const stepMonth = (delta: number) => {
    const base = active ? new Date(`${active.key}-02T00:00:00`) : startOfMonth(now);
    setMonthParam(format(addMonths(base, delta), 'yyyy-MM'));
  };

  const canStepForward = active ? !viewingCurrent : false;

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Month view"
      sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5 }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ minWidth: 0 }}
      >
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
          <IconButton size="small" onClick={() => stepMonth(-1)} aria-label="Previous month">
            <ChevronLeftIcon />
          </IconButton>
          <Typography
            variant="subtitle1"
            fontWeight={700}
            color="text.primary"
            noWrap
            sx={{ minWidth: { xs: 0, sm: 148 }, textAlign: 'center' }}
          >
            {active ? active.label : 'All time'}
          </Typography>
          <IconButton
            size="small"
            onClick={() => stepMonth(1)}
            disabled={!canStepForward}
            aria-label="Next month"
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
          <Button
            size="small"
            variant={viewingCurrent ? 'outlined' : 'text'}
            disabled={viewingCurrent}
            onClick={() => setMonthParam(format(now, 'yyyy-MM'))}
            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
          >
            This month
          </Button>
          <Button
            size="small"
            variant={!active ? 'outlined' : 'text'}
            disabled={!active}
            onClick={() => setMonthParam(null)}
            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
          >
            All time
          </Button>
        </Stack>
      </Stack>

      {active && summary && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.75, textAlign: 'center' }}
        >
          Total{' '}
          <MoneyText
            amount={summary.totalAmount}
            currency={currency}
            tone="neutral"
            variant="caption"
            fontWeight={700}
          />{' '}
          · {summary.count} expense{summary.count === 1 ? '' : 's'} · you fronted{' '}
          <MoneyText
            amount={summary.userFronted}
            currency={currency}
            tone="neutral"
            variant="caption"
            fontWeight={700}
          />
        </Typography>
      )}
    </Paper>
  );
}
