'use client';

import Link from 'next/link';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import AddIcon from '@mui/icons-material/Add';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PaymentsIcon from '@mui/icons-material/Payments';
import SettingsIcon from '@mui/icons-material/Settings';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import TripStrip from '@/components/trip/TripStrip';
import GroupHeader from '@/components/groups/GroupHeader';
import MoneyText from '@/components/common/MoneyText';
import { fetcher } from '@/lib/utils/fetcher';
import { formatDate, formatRelativeTime } from '@/lib/utils/date';
import { getGroupTheme } from '@/lib/group-themes';
import type { DashboardBalanceAmount, GroupCategory } from '@/types';

interface GroupCardProps {
  group: Record<string, unknown>;
  userId: string;
  balances?: DashboardBalanceAmount[];
  hasMixedCurrencies?: boolean;
  balanceUnavailable?: boolean;
  mode?: 'dashboard' | 'management';
}

/**
 * This month's spend for a Household card — one extra date-ranged summary
 * request, only mounted for `monthCycle` themes. Viewer-local month bounds,
 * full ISO so the service respects them as-is.
 */
function HouseholdMonthSpend({ groupId, currency }: { groupId: string; currency: string }) {
  const now = new Date();
  const params = new URLSearchParams({
    dateFrom: startOfMonth(now).toISOString(),
    dateTo: endOfMonth(now).toISOString(),
    page: '1',
    limit: '1',
  });
  const { data } = useSWR(`/api/groups/${groupId}/expenses?${params.toString()}`, fetcher);
  const summary = data?.data?.summary as { totalAmount?: number; count?: number } | undefined;
  if (!summary) return null;

  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
      {format(now, 'MMMM')} so far ·{' '}
      <MoneyText
        amount={summary.totalAmount ?? 0}
        currency={currency}
        tone="neutral"
        variant="caption"
        fontWeight={700}
      />{' '}
      across {summary.count ?? 0} expense{(summary.count ?? 0) === 1 ? '' : 's'}
    </Typography>
  );
}

export default function GroupCard({
  group,
  userId,
  balances = [],
  hasMixedCurrencies = false,
  balanceUnavailable = false,
  mode = 'dashboard',
}: GroupCardProps) {
  const members = [
    ...((group.members || []) as Array<{
      user: { _id: string; name: string; image?: string };
      role: string;
    }>),
  ].sort((a, b) => Number(b.user._id === userId) - Number(a.user._id === userId));
  const category = group.category as string;
  const theme = getGroupTheme(category as GroupCategory);
  const groupId = group._id as string;
  const groupName = group.name as string;
  const currency = group.defaultCurrency as string;
  const startDate = group.startDate as string | undefined;
  const endDate = group.endDate as string | undefined;
  const updatedAt = group.updatedAt as string | undefined;
  const payableBalance = balances.find((balance) => balance.balance < 0);
  const dominantBalance = balances.reduce<DashboardBalanceAmount | null>(
    (current, item) =>
      !current || Math.abs(item.balance) > Math.abs(current.balance) ? item : current,
    null,
  );
  const dateLabel =
    theme.dates === 'bounded'
      ? startDate && endDate
        ? `${formatDate(startDate)} – ${formatDate(endDate)}`
        : startDate
          ? `Starts ${formatDate(startDate)}`
          : null
      : null;

  if (mode === 'dashboard') {
    return (
      <Paper
        variant="outlined"
        sx={{
          overflow: 'hidden',
          transition: 'box-shadow 0.2s',
          '&:hover': { boxShadow: 2 },
        }}
      >
        {theme.header === 'strip' ? (
          <TripStrip
            name={groupName}
            currency={currency}
            variant="compact"
            href={`/groups/${groupId}`}
            dateLabel={dateLabel}
            memberCount={members.length}
            joinedBottom
            balanceUnavailable={balanceUnavailable}
            balance={
              dominantBalance
                ? { amount: dominantBalance.balance, currency: dominantBalance.currency }
                : null
            }
          />
        ) : (
          <GroupHeader
            name={groupName}
            themeLabel={theme.label}
            themeIcon={theme.icon}
            currency={currency}
            variant="compact"
            href={`/groups/${groupId}`}
            members={members.map((member) => member.user)}
            joinedBottom
            balanceUnavailable={balanceUnavailable}
            balance={
              dominantBalance
                ? { amount: dominantBalance.balance, currency: dominantBalance.currency }
                : null
            }
          />
        )}
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <AvatarGroup
              max={4}
              sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 12 } }}
            >
              {members.map((m) => (
                <Avatar
                  key={m.user._id}
                  src={m.user.image}
                  alt={m.user.name}
                  sx={{ width: 28, height: 28 }}
                >
                  {m.user.name?.[0]}
                </Avatar>
              ))}
            </AvatarGroup>
            {hasMixedCurrencies ? (
              <Chip label="Mixed currency" size="small" color="warning" variant="outlined" />
            ) : (
              <Typography variant="caption" color="text.secondary">
                {members.length} member{members.length !== 1 ? 's' : ''}
              </Typography>
            )}
          </Stack>

          {theme.signature === 'monthCycle' && (
            <HouseholdMonthSpend groupId={groupId} currency={currency} />
          )}

          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
            {updatedAt ? `Last activity ${formatRelativeTime(updatedAt)}` : 'No activity yet'}
          </Typography>

          <Divider sx={{ my: 1.5 }} />

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              component={Link}
              href={`/groups/${groupId}`}
              size="small"
              variant="contained"
              endIcon={<ArrowForwardIcon />}
            >
              Open {theme.nouns.singular}
            </Button>
            <Button
              component={Link}
              href={
                payableBalance
                  ? `/groups/${groupId}?tab=balances`
                  : `/groups/${groupId}?action=add-expense`
              }
              size="small"
              variant="outlined"
              startIcon={payableBalance ? <PaymentsIcon /> : <AddIcon />}
            >
              {payableBalance ? 'Settle' : 'Add expense'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 3,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: 2 },
      }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography component="span" sx={{ fontSize: '1.5rem' }}>
            {theme.icon}
          </Typography>
          <Box>
            <Typography
              component={Link}
              href={`/groups/${groupId}`}
              variant="body1"
              fontWeight={700}
              color="text.primary"
              sx={{ textDecoration: 'none', '&:hover': { color: 'primary.main' } }}
            >
              {groupName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {dateLabel || theme.label}
            </Typography>
          </Box>
        </Stack>
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <AvatarGroup max={4} sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 12 } }}>
          {members.map((m) => (
            <Avatar
              key={m.user._id}
              src={m.user.image}
              alt={m.user.name}
              sx={{ width: 28, height: 28 }}
            >
              {m.user.name?.[0]}
            </Avatar>
          ))}
        </AvatarGroup>
        <Typography variant="caption" color="text.secondary">
          {members.length} member{members.length !== 1 ? 's' : ''}
        </Typography>
      </Stack>

      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1.5 }}>
        {updatedAt ? `Last activity ${formatRelativeTime(updatedAt)}` : 'No activity yet'}
      </Typography>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          component={Link}
          href={`/groups/${groupId}`}
          size="small"
          variant="outlined"
          endIcon={<ArrowForwardIcon />}
        >
          Open {theme.nouns.singular}
        </Button>
        <Button
          component={Link}
          href={`/groups/${groupId}/settings`}
          size="small"
          startIcon={<SettingsIcon />}
        >
          Manage
        </Button>
      </Stack>
    </Paper>
  );
}
