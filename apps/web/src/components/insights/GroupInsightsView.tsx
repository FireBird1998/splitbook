'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import EastIcon from '@mui/icons-material/East';
import type { GroupInsightsRead } from '@splitbook/shared/group-insights-read';
import SegmentedControl from '@/components/charts/SegmentedControl';
import ErrorState from '@/components/common/ErrorState';
import { HomeRow } from '@/components/dashboard/HomeCard';
import { monthLabel } from '@/components/dashboard/spending-chart';
import { RADIUS } from '@/lib/theme/tokens';
import { visuallyHidden } from './a11y';
import MonthlySpendingCard, { type MonthlyView } from './MonthlySpendingCard';
import {
  COMPARE_CHOICES,
  compareLabel,
  insightsHref,
  insightsStats,
  monthSteps,
  monthlySpending,
  otherCurrenciesNote,
  type CompareChoice,
  type InsightsAddress,
  type InsightsStats,
} from './group-insights';

/*
 * A Group's Insights tab (#314, design canvas "Web portal", Group insights): Month navigation
 * and the range in the address, the Month's stat cards, and monthly spending with the average
 * of the months before it. By Tag, Who paid and the recurring Expenses card come with #315; a
 * Trip shows this same Month view until its Trip summary (#316).
 */

export interface GroupInsightsViewProps {
  groupId: string;
  userId: string;
  address: InsightsAddress;
  /** The viewer's current Month, in their own time zone. */
  currentMonth: string;
  /** Whether the Group's Theme has recurring Expenses at all (a Household's does). */
  recurringTheme: boolean;
  /** The read for this address; undefined while it loads. */
  read: GroupInsightsRead | undefined;
  failed: boolean;
  onRetry: () => void;
  onCompareChange: (compare: CompareChoice) => void;
  /** The monthly spending card's first view. */
  initialView?: MonthlyView;
}

type CardState = 'ready' | 'loading' | 'failed' | 'empty';

export default function GroupInsightsView({
  groupId,
  userId,
  address,
  currentMonth,
  recurringTheme,
  read,
  failed,
  onRetry,
  onCompareChange,
  initialView,
}: GroupInsightsViewProps) {
  // A read for another Month (one still in the cache) is never shown under this one's name.
  const shown =
    read && read.month === address.month && read.compare === address.compare ? read : undefined;
  const state: CardState = shown
    ? shown.hasExpenses
      ? 'ready'
      : 'empty'
    : failed
      ? 'failed'
      : 'loading';
  const monthLong = monthLabel(address.month, 'long');
  const note = shown ? otherCurrenciesNote(shown) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <MonthBar
        groupId={groupId}
        address={address}
        currentMonth={currentMonth}
        firstMonth={shown?.firstMonth ?? null}
        onCompareChange={onCompareChange}
      />

      <Box
        component="section"
        aria-label={`${monthLong} in figures`}
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
          gap: 1.5,
        }}
      >
        {state === 'ready' && shown ? (
          <StatCards stats={insightsStats(shown, { userId, recurringTheme })} />
        ) : state === 'empty' ? (
          <Panel>
            <Typography component="p" sx={{ fontWeight: 600, color: 'text.primary' }}>
              No Expenses yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Once this Group has Expenses, each month’s figures show here.
            </Typography>
          </Panel>
        ) : state === 'failed' ? (
          <Panel plain>
            <ErrorState
              message={`The figures for ${monthLong} could not be loaded.`}
              onRetry={onRetry}
              retryLabel="Try again"
            />
          </Panel>
        ) : (
          <Box
            role="status"
            aria-label={`Loading the figures for ${monthLong}`}
            aria-busy="true"
            sx={{ display: 'contents' }}
          >
            {['Spent', 'Your share', 'Expenses', 'Biggest expense'].map((label) => (
              <StatCard key={label} label={label}>
                <Skeleton variant="text" width="70%" height={36} />
                <Skeleton variant="text" width="55%" height={18} />
              </StatCard>
            ))}
          </Box>
        )}
      </Box>

      {note ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
          {note}
        </Typography>
      ) : null}

      <HomeRow>
        <MonthlySpendingCard
          key={`${address.month}:${address.compare}`}
          model={shown && state === 'ready' ? monthlySpending(shown, { currentMonth }) : null}
          state={state}
          onRetry={onRetry}
          initialView={initialView}
        />
      </HomeRow>
    </Box>
  );
}

/** A full-row panel inside the figures grid, for its empty and failed states. */
function Panel({ children, plain = false }: { children: ReactNode; plain?: boolean }) {
  return (
    <Box
      sx={{
        gridColumn: '1 / -1',
        ...(plain
          ? {}
          : {
              p: 2,
              borderRadius: `${RADIUS.md}px`,
              bgcolor: 'surface.muted',
            }),
      }}
    >
      {children}
    </Box>
  );
}

const iconButtonSx = {
  width: 44,
  height: 44,
  borderRadius: '12px',
  color: 'text.secondary',
  '&:hover': { bgcolor: 'surface.muted', color: 'text.primary' },
} as const;

/** One step of the Month navigation: a link, or a button that says why it can't go. */
function MonthStep({
  direction,
  href,
  label,
  reason,
}: {
  direction: 'previous' | 'next';
  href: string;
  label: string;
  reason: string | null;
}) {
  const icon = direction === 'previous' ? <ChevronLeftIcon /> : <ChevronRightIcon />;
  const name = direction === 'previous' ? 'Previous month' : 'Next month';
  if (reason)
    return (
      <Tooltip title={`Unavailable: ${reason}`}>
        <IconButton
          aria-label={`${name}, unavailable: ${reason}`}
          aria-disabled="true"
          disableRipple
          onClick={(event) => event.preventDefault()}
          sx={{ ...iconButtonSx, opacity: 0.4, cursor: 'default', '&:hover': {} }}
        >
          {icon}
        </IconButton>
      </Tooltip>
    );
  return (
    <IconButton
      component={Link}
      href={href}
      replace
      scroll={false}
      aria-label={`${name}, ${label}`}
      sx={iconButtonSx}
    >
      {icon}
    </IconButton>
  );
}

function MonthBar({
  groupId,
  address,
  currentMonth,
  firstMonth,
  onCompareChange,
}: {
  groupId: string;
  address: InsightsAddress;
  currentMonth: string;
  firstMonth: string | null;
  onCompareChange: (compare: CompareChoice) => void;
}) {
  const steps = monthSteps(address.month, { currentMonth, firstMonth });
  const href = (month: string) => insightsHref(groupId, { ...address, month }, currentMonth);
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <MonthStep
          direction="previous"
          href={href(steps.previous.month)}
          label={steps.previous.label}
          reason={steps.previous.reason}
        />
        <Typography
          component="h2"
          sx={{
            fontSize: '1.375rem',
            lineHeight: 1.2,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'text.primary',
            minWidth: { xs: 0, sm: 190 },
            textAlign: 'center',
          }}
        >
          {monthLabel(address.month, 'long')}
        </Typography>
        <MonthStep
          direction="next"
          href={href(steps.next.month)}
          label={steps.next.label}
          reason={steps.next.reason}
        />
      </Box>
      <SegmentedControl
        label="Compare with the months before"
        value={String(address.compare)}
        options={COMPARE_CHOICES.map((count) => ({
          value: String(count),
          label: compareLabel(count),
        }))}
        onChange={(value) => onCompareChange(Number(value) as CompareChoice)}
      />
    </Box>
  );
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minWidth: 0,
        p: '16px 18px 18px',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
      }}
    >
      <Typography
        component="p"
        sx={{ fontSize: '0.8125rem', lineHeight: 1.4, color: 'text.secondary' }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}

const figureSx = {
  fontSize: '1.75rem',
  lineHeight: 1.1,
  letterSpacing: '-0.03em',
  color: 'text.primary',
  overflowWrap: 'anywhere',
} as const;

const subSx = { fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' } as const;

function Figure({ children, money = true }: { children: ReactNode; money?: boolean }) {
  return (
    <Typography
      component="p"
      sx={[money ? (theme) => ({ ...theme.typography.money }) : { fontWeight: 600 }, figureSx]}
    >
      {children}
    </Typography>
  );
}

const changeColor = { up: 'status.warning', down: 'status.positive', level: 'text.secondary' };
const ChangeIcon = { up: NorthEastIcon, down: SouthEastIcon, level: EastIcon };

function StatCards({ stats }: { stats: InsightsStats }) {
  const { spent, share, expenses, biggest } = stats;
  const Icon = spent.change ? ChangeIcon[spent.change.direction] : null;
  return (
    <>
      <StatCard label="Spent">
        <Figure>{spent.text}</Figure>
        {spent.change && Icon ? (
          <Box
            component="p"
            sx={{
              ...subSx,
              m: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '2px 6px',
            }}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                fontWeight: 600,
                color: changeColor[spent.change.direction],
              }}
            >
              <Icon sx={{ fontSize: 16 }} aria-hidden="true" />
              {spent.change.headline}
            </Box>
            <span>
              {spent.change.against}{' '}
              <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
                {spent.change.averageText}
              </Box>
            </span>
          </Box>
        ) : (
          <Typography component="p" sx={subSx}>
            {spent.noComparison}
          </Typography>
        )}
      </StatCard>
      <StatCard label="Your share">
        <Figure>{share.text}</Figure>
        <Typography component="p" sx={subSx}>
          You paid{' '}
          <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
            {share.paidText}
          </Box>
        </Typography>
      </StatCard>
      <StatCard label="Expenses">
        <Figure money={false}>{expenses.count}</Figure>
        {expenses.recurringLine ? (
          <Typography component="p" sx={subSx}>
            {expenses.recurringLine}
          </Typography>
        ) : null}
      </StatCard>
      <StatCard label="Biggest expense">
        {biggest ? (
          <>
            <Figure>{biggest.text}</Figure>
            <Typography
              component="p"
              title={biggest.line}
              sx={{ ...subSx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {biggest.line}
            </Typography>
          </>
        ) : (
          <>
            <Figure money={false}>
              <span aria-hidden="true">–</span>
              <Box component="span" sx={visuallyHidden}>
                None
              </Box>
            </Figure>
            <Typography component="p" sx={subSx}>
              No Expenses in {stats.monthLong}
            </Typography>
          </>
        )}
      </StatCard>
    </>
  );
}
