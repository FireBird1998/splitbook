'use client';

import Link from 'next/link';
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
import { formatCurrency } from '@/lib/utils/currency';
import { formatDate, formatRelativeTime } from '@/lib/utils/date';
import type { DashboardBalanceAmount } from '@/types';

const CATEGORY_ICONS: Record<string, string> = {
  trip: '✈️',
  home: '🏠',
  couple: '💑',
  work: '💼',
  other: '📋',
};

interface GroupCardProps {
  group: Record<string, unknown>;
  userId: string;
  balances?: DashboardBalanceAmount[];
  hasMixedCurrencies?: boolean;
  mode?: 'dashboard' | 'management';
}

export default function GroupCard({
  group,
  userId,
  balances = [],
  hasMixedCurrencies = false,
  mode = 'dashboard',
}: GroupCardProps) {
  const members = [
    ...((group.members || []) as Array<{
      user: { _id: string; name: string; image?: string };
      role: string;
    }>),
  ].sort((a, b) => Number(b.user._id === userId) - Number(a.user._id === userId));
  const category = group.category as string;
  const icon = CATEGORY_ICONS[category] || '📋';
  const groupId = group._id as string;
  const startDate = group.startDate as string | undefined;
  const endDate = group.endDate as string | undefined;
  const updatedAt = group.updatedAt as string | undefined;
  const payableBalance = balances.find((balance) => balance.balance < 0);
  const dateLabel =
    startDate && endDate
      ? `${formatDate(startDate)} – ${formatDate(endDate)}`
      : startDate
        ? `Starts ${formatDate(startDate)}`
        : null;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 3,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: 3 },
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
            {icon}
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
              {group.name as string}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'capitalize' }}
            >
              {dateLabel || category}
            </Typography>
          </Box>
        </Stack>
        {hasMixedCurrencies && (
          <Chip label="Mixed currency" size="small" color="warning" variant="outlined" />
        )}
      </Stack>

      {mode === 'dashboard' && (
        <Box sx={{ minHeight: 48, mb: 2 }}>
          {balances.length === 0 ? (
            <Typography variant="body2" fontWeight={600} color="success.main">
              Settled up
            </Typography>
          ) : (
            <Stack spacing={0.5}>
              {balances.map((item) => (
                <Stack
                  key={item.currency}
                  direction="row"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Typography variant="caption" color="text.secondary">
                    {item.balance < 0 ? 'You owe' : "You're owed"}
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={700}
                    color={item.balance < 0 ? 'error.main' : 'success.main'}
                  >
                    {formatCurrency(Math.abs(item.balance), item.currency)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      )}

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
          variant={mode === 'dashboard' ? 'contained' : 'outlined'}
          endIcon={<ArrowForwardIcon />}
        >
          Open trip
        </Button>
        {mode === 'dashboard' ? (
          <Button
            component={Link}
            href={
              payableBalance
                ? `/groups/${groupId}?tab=balances`
                : `/groups/${groupId}?action=add-expense`
            }
            size="small"
            startIcon={payableBalance ? <PaymentsIcon /> : <AddIcon />}
          >
            {payableBalance ? 'Settle' : 'Add expense'}
          </Button>
        ) : (
          <Button
            component={Link}
            href={`/groups/${groupId}/settings`}
            size="small"
            startIcon={<SettingsIcon />}
          >
            Manage
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
