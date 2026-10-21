'use client';
import PreparedBy from '@/components/expenses/PreparedBy';

import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { activityPageKey } from '@splitbook/shared/query-keys';
import useSWRInfinite from 'swr/infinite';
import Button from '@mui/material/Button';
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
} from '@splitbook/shared/activity-timeline';
import { fetchWebActivity } from '@/lib/web-read';
import { useState } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import { readCrossCurrencyRecord } from '@splitbook/shared/cross-currency-payment';
import PaymentRecordCard from './PaymentRecordCard';

const ACTIVITY_ICONS: Record<string, string> = {
  expense_added: '🧾',
  expense_updated: '✏️',
  expense_deleted: '🗑️',
  settlement_recorded: '💰',
  member_joined: '👤',
  member_left: '👋',
  group_created: '🎉',
  group_updated: '⚙️',
  assistant_rule_changed: '🤖',
};

interface ActivityViewProps {
  groupId: string;
  /** The signed-in member, who is "You" in each event (#442). */
  viewerId: string;
}

export default function ActivityView({ groupId, viewerId }: ActivityViewProps) {
  const { data, isLoading, error, isValidating, size, setSize } = useSWRInfinite(
    (index, previous: Awaited<ReturnType<typeof fetchWebActivity>> | null) => {
      if (previous && previous.data.pagination.page >= previous.data.pagination.totalPages)
        return null;
      return activityPageKey(WEB_QUERY_ACCOUNT, groupId, { page: index + 1, limit: 50 });
    },
    fetchWebActivity,
    {
      refreshInterval: 10_000,
      // Page offsets move together when a new event arrives.
      revalidateAll: true,
    },
  );

  /** The payment whose card is open beside the list (#727). */
  const [openId, setOpenId] = useState<string | null>(null);
  // A new event can move the last event of a page onto the next one.
  const seen = new Set<string>();
  const activities = (data?.flatMap((page) => page.data.activities) || []).filter((activity) => {
    if (seen.has(activity._id)) return false;
    seen.add(activity._id);
    return true;
  }) as ActivityLike[];
  const lastPage = data?.at(-1)?.data.pagination;
  const hasOlder = Boolean(lastPage && lastPage.page < lastPage.totalPages);
  const loadingOlder = isValidating && Boolean(data && size > data.length);
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

  if (error && !data) {
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

  const opened = activities.find((activity) => activity._id === openId);
  const openRecord =
    opened?.type === 'settlement_recorded' ? readCrossCurrencyRecord(opened.metadata) : null;

  const list = (
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
              const detail = formatActivityDetail(activity, viewerId);
              // A Debt paid in another currency opens its card (#727).
              const payment =
                type === 'settlement_recorded' && readCrossCurrencyRecord(activity.metadata);
              const open = payment && activity._id === openId;
              const rowSx = {
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                py: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-of-type': { borderBottom: 'none' },
              } as const;
              // Spans, so the row's words can sit inside a button.
              const content = (
                <>
                  <Typography component="span" sx={{ fontSize: '1.125rem', mt: 0.15 }} aria-hidden>
                    {icon}
                  </Typography>
                  <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0 }}>
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.primary"
                      sx={{ display: 'block' }}
                    >
                      {formatActivityHeadline(activity, viewerId)}
                      <PreparedBy value={activity.metadata?.preparedBy} inline />
                    </Typography>
                    {detail && (
                      <Typography
                        component="span"
                        variant="body2"
                        fontWeight={600}
                        color="text.secondary"
                        sx={{ mt: 0.25, display: 'block' }}
                      >
                        {detail}
                      </Typography>
                    )}
                    {/* Secondary, not disabled: the timestamps sit on the page background,
                        where the muted tone falls short of 4.5:1 in light (#305, axe). */}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 0.25, display: 'block' }}
                    >
                      {formatActivityTimestamp(activity)}
                    </Typography>
                  </Box>
                </>
              );

              return payment ? (
                <ButtonBase
                  key={activity._id}
                  aria-expanded={Boolean(open)}
                  onClick={() => setOpenId(open ? null : activity._id)}
                  sx={{
                    ...rowSx,
                    width: '100%',
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    px: 1,
                    mx: -1,
                    borderRadius: '10px',
                    bgcolor: open ? 'tint.brand' : undefined,
                    '&:hover': { bgcolor: open ? 'tint.brand' : 'action.hover' },
                  }}
                >
                  {content}
                </ButtonBase>
              ) : (
                <Box key={activity._id} sx={rowSx}>
                  {content}
                </Box>
              );
            })}
          </Stack>
        </Box>
      ))}
      {error && (
        <Typography
          role="alert"
          variant="body2"
          sx={{ color: 'status.negative', textAlign: 'center' }}
        >
          Couldn’t load older activity. The events shown are still here.
        </Typography>
      )}
      {(hasOlder || error) && (
        <Button
          variant="text"
          disabled={loadingOlder}
          onClick={() => void setSize((data?.length ?? 0) + (hasOlder ? 1 : 0))}
          sx={{ alignSelf: 'center' }}
        >
          {loadingOlder
            ? 'Loading older activity…'
            : error
              ? 'Try loading older activity'
              : 'Load older activity'}
        </Button>
      )}
    </Stack>
  );

  return openRecord && opened ? (
    <Box
      sx={{
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 380px' },
        alignItems: 'start',
      }}
    >
      <Box sx={{ order: { xs: 2, md: 1 }, minWidth: 0 }}>{list}</Box>
      <Box sx={{ order: { xs: 1, md: 2 }, position: { md: 'sticky' }, top: { md: 88 } }}>
        <PaymentRecordCard
          record={openRecord}
          recordedBy={opened.actor}
          recordedAt={opened.createdAt}
          viewerId={viewerId}
          onClose={() => setOpenId(null)}
        />
      </Box>
    </Box>
  ) : (
    list
  );
}
