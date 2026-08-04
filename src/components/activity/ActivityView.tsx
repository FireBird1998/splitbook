'use client';

import useSWR from 'swr';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import {
  formatActivityDetail,
  formatActivityHeadline,
  formatActivityTimestamp,
  groupActivitiesByDay,
  type ActivityLike,
} from '@/lib/utils/activity-timeline';
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

interface ActivityViewProps {
  groupId: string;
}

export default function ActivityView({ groupId }: ActivityViewProps) {
  const { data, isLoading, error } = useSWR(
    `/api/groups/${groupId}/activity?page=1&limit=50`,
    fetcher,
    {
      refreshInterval: 10_000,
    },
  );

  const activities = (data?.data?.activities || []) as ActivityLike[];
  const groups = groupActivitiesByDay(activities);

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
    return <Typography color="error.main">{error.message}</Typography>;
  }

  if (activities.length === 0) {
    return (
      <Box sx={{ py: { xs: 4, sm: 6 }, textAlign: 'center' }}>
        <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
          No activity yet
        </Typography>
        <Typography color="text.secondary">
          Expense and settlement changes will show up here as an audit trail.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      {groups.map((group) => (
        <Box key={group.key}>
          <Typography
            variant="caption"
            fontWeight={700}
            color="text.secondary"
            sx={{
              display: 'block',
              mb: 1,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {group.label}
          </Typography>
          <Stack spacing={0}>
            {group.activities.map((activity) => {
              const type = activity.type;
              const icon = ACTIVITY_ICONS[type] || '📋';
              const detail = formatActivityDetail(activity);

              return (
                <Box
                  key={activity._id}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    py: 1.5,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-of-type': { borderBottom: 'none' },
                  }}
                >
                  <Typography component="span" sx={{ fontSize: '1.125rem', mt: 0.15 }} aria-hidden>
                    {icon}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" color="text.primary">
                      {formatActivityHeadline(activity)}
                    </Typography>
                    {detail && (
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        color="text.secondary"
                        sx={{ mt: 0.25 }}
                      >
                        {detail}
                      </Typography>
                    )}
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ mt: 0.25, display: 'block' }}
                    >
                      {formatActivityTimestamp(activity)}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
