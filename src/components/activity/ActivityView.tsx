'use client';

import useSWR from 'swr';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import { formatDateTime } from '@/lib/utils/date';
import { formatCurrency } from '@/lib/utils/currency';
import { fetcher } from '@/lib/utils/fetcher';

const ACTIVITY_ICONS: Record<string, string> = {
  expense_added: '🧾',
  expense_updated: '✏️',
  expense_deleted: '🗑️',
  settlement_recorded: '💰',
  member_joined: '👤',
  member_left: '👋',
  group_created: '🎉',
  group_updated: '⚙️',
};

function getActivityText(activity: Record<string, unknown>): string {
  const actor = activity.actor as { name: string };
  const meta = activity.metadata as Record<string, unknown>;
  const type = activity.type as string;

  switch (type) {
    case 'expense_added':
      return `${actor.name} added "${meta.description}" — ${formatCurrency(meta.amount as number, meta.currency as string)}`;
    case 'expense_updated':
      return `${actor.name} updated "${meta.description}"`;
    case 'expense_deleted':
      return `${actor.name} deleted "${meta.description}"`;
    case 'settlement_recorded':
      return `${actor.name} recorded a payment of ${formatCurrency(meta.amount as number, meta.currency as string)}`;
    case 'member_joined':
      return `${actor.name} joined the group`;
    case 'member_left':
      return `${actor.name} left the group`;
    case 'group_created':
      return `${actor.name} created the group`;
    case 'group_updated':
      return `${actor.name} updated the group`;
    default:
      return `${actor.name} performed an action`;
  }
}

interface ActivityViewProps {
  groupId: string;
}

export default function ActivityView({ groupId }: ActivityViewProps) {
  const { data, isLoading, error } = useSWR(`/api/groups/${groupId}/activity?page=1&limit=50`, fetcher, {
    refreshInterval: 10_000,
  });

  const activities = data?.data?.activities || [];

  if (isLoading) {
    return (
      <Stack spacing={1.5}>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="rounded" height={64} />
        ))}
      </Stack>
    );
  }

  if (error) {
    return (
      <Typography color="error.main">{error.message}</Typography>
    );
  }

  if (activities.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
        <Typography component="span" sx={{ fontSize: '2.5rem', display: 'block', mb: 2 }}>
          📝
        </Typography>
        <Typography variant="subtitle1" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
          No activity yet
        </Typography>
        <Typography color="text.secondary">Actions in this group will appear here.</Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={1}>
      {activities.map((activity: Record<string, unknown>) => {
        const type = activity.type as string;
        const icon = ACTIVITY_ICONS[type] || '📋';

        return (
          <Paper
            key={activity._id as string}
            variant="outlined"
            sx={{
              px: 2,
              py: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.5,
            }}
          >
            <Typography component="span" sx={{ fontSize: '1.125rem', mt: 0.25 }}>
              {icon}
            </Typography>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" color="text.primary">
                {getActivityText(activity)}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.25 }}>
                {formatDateTime(activity.createdAt as string)}
              </Typography>
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
}
