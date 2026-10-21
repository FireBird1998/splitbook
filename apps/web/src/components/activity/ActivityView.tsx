'use client';
import PreparedBy from '@/components/expenses/PreparedBy';

import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { activityPageKey } from '@splitbook/shared/query-keys';
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
} from '@splitbook/shared/activity-timeline';
import { fetchWebActivity } from '@/lib/web-read';
import { useState } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import { readCrossCurrencyRecord } from '@splitbook/shared/cross-currency-payment';
import { groupSettlementBatches } from '@splitbook/shared/settlement-batch-activity';
import { settlementBatchWords } from '@splitbook/shared/settlement-batch-words';
import type { ActivityBatch } from './batch-words';
import BatchPaymentCard from './BatchPaymentCard';
import PaymentRecordCard from './PaymentRecordCard';

type Batch = ActivityBatch<ActivityLike>;

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
  const { data, isLoading, error } = useSWR(
    activityPageKey(WEB_QUERY_ACCOUNT, groupId, { page: 1, limit: 50 }),
    fetchWebActivity,
    {
      refreshInterval: 10_000,
    },
  );

  /** The payment whose card is open beside the list (#727). */
  const [openId, setOpenId] = useState<string | null>(null);
  const activities = (data?.data?.activities || []) as ActivityLike[];
  // A payment that settled several Debts at once is one row, where its first event is (#734).
  const grouped = groupSettlementBatches(activities);
  const rows = grouped.map((item) => (item.kind === 'event' ? item.event : item.events[0]));
  const batches = new Map(
    grouped.flatMap((item): [string, Batch][] =>
      item.kind === 'batch' ? [[item.events[0]._id, item]] : [],
    ),
  );
  const groups = groupActivitiesByDay(rows);

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

  const opened = rows.find((activity) => activity._id === openId);
  const openBatch = opened ? batches.get(opened._id) : undefined;
  const openRecord =
    !openBatch && opened?.type === 'settlement_recorded'
      ? readCrossCurrencyRecord(opened.metadata)
      : null;
  const wordsOf = (batch: Batch) => settlementBatchWords(batch.events, batch.batchSize, viewerId);

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
              const batch = batches.get(activity._id);
              const words = batch ? wordsOf(batch) : null;
              const detail = formatActivityDetail(activity, viewerId);
              // A Debt paid in another currency opens its card (#727), as does a payment that
              // settled several (#734).
              const payment =
                Boolean(batch) ||
                (type === 'settlement_recorded' && readCrossCurrencyRecord(activity.metadata));
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
                      {words ? words.headline : formatActivityHeadline(activity, viewerId)}
                      {!words && <PreparedBy value={activity.metadata?.preparedBy} inline />}
                    </Typography>
                    {/* Each Debt it cleared and its rate, then where the rest of it is (#734). */}
                    {words &&
                      [...words.debts, ...(words.rest ? [words.rest] : [])].map((line) => (
                        <Typography
                          key={line}
                          component="span"
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.25, display: 'block' }}
                        >
                          {line}
                        </Typography>
                      ))}
                    {!words && detail && (
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
    </Stack>
  );

  const card =
    openBatch && opened ? (
      <BatchPaymentCard
        words={wordsOf(openBatch)}
        recordedBy={opened.actor}
        recordedAt={opened.createdAt}
        viewerId={viewerId}
        onClose={() => setOpenId(null)}
      />
    ) : openRecord && opened ? (
      <PaymentRecordCard
        record={openRecord}
        recordedBy={opened.actor}
        recordedAt={opened.createdAt}
        viewerId={viewerId}
        onClose={() => setOpenId(null)}
      />
    ) : null;

  return card ? (
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
        {card}
      </Box>
    </Box>
  ) : (
    list
  );
}
