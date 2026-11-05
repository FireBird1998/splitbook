'use client';
import PreparedBy from '@/components/expenses/PreparedBy';

import { webActivityPage } from '@/lib/web-query-keys';
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
import { keyboardFocusRing } from '@/lib/theme/focus-ring';
import { useEffect, useRef, useState } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import { readCrossCurrencyRecord } from '@splitbook/shared/cross-currency-payment';
import { groupSettlementBatches } from '@splitbook/shared/settlement-batch-activity';
import { settlementBatchWords } from '@splitbook/shared/settlement-batch-words';
import { newestEvent, type ActivityBatch } from './batch-words';
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
  const { data, isLoading, error, isValidating, size, setSize } = useSWRInfinite(
    (index, previous: Awaited<ReturnType<typeof fetchWebActivity>> | null) => {
      if (previous && previous.data.pagination.page >= previous.data.pagination.totalPages)
        return null;
      return webActivityPage(groupId, index);
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
  // Opening a row's card moves keyboard focus to the card's heading, and closing the card puts it
  // back on the row that opened it, so a keyboard user keeps their place (#852).
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  /** Each row that opens a card, by its event's id. */
  const cardRows = useRef(new Map<string, HTMLElement>());
  /** Where focus goes once the card has opened or closed: its heading, or the row it was for. */
  const focusNext = useRef<{ card: true } | { row: string } | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (!next) return;
    if ('card' in next) cardHeadingRef.current?.focus();
    else cardRows.current.get(next.row)?.focus();
  }, [openId]);
  // Closed from its own row, focus stays on the row.
  const toggle = (id: string, open: boolean) => {
    focusNext.current = open ? null : { card: true };
    setOpenId(open ? null : id);
  };
  const closeCard = () => {
    focusNext.current = openId ? { row: openId } : null;
    setOpenId(null);
  };
  // A new event can move the last event of a page onto the next one.
  const seen = new Set<string>();
  const activities = (data?.flatMap((page) => page.data.activities) || []).filter((activity) => {
    if (seen.has(activity._id)) return false;
    seen.add(activity._id);
    return true;
  }) as ActivityLike[];
  const lastPage = data?.at(-1)?.data.pagination;
  const hasOlder = Boolean(lastPage && lastPage.page < lastPage.totalPages);
  // Asked for more pages than are loaded: an older page is on its way, or its read failed. A
  // failed refresh of the pages shown is not that, and says nothing: the events stay.
  const askedOlder = Boolean(data && size > data.length);
  const loadingOlder = isValidating && askedOlder;
  const olderFailed = Boolean(error) && askedOlder;
  // Group all loaded pages together: a split payment becomes one complete row when its older
  // events arrive, at the first event already shown (#734, #800).
  const grouped = groupSettlementBatches(activities);
  const rows = grouped.map((item) =>
    item.kind === 'event' ? item.event : newestEvent(item, activities),
  );
  const batches = new Map(
    grouped.flatMap((item): [string, Batch][] =>
      item.kind === 'batch' ? [[newestEvent(item, activities)._id, item]] : [],
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

  if (error && !data) {
    return <Typography sx={{ color: 'status.negative' }}>{error.message}</Typography>;
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
                  ref={(row: HTMLElement | null) => {
                    if (!row) return;
                    cardRows.current.set(activity._id, row);
                    return () => {
                      cardRows.current.delete(activity._id);
                    };
                  }}
                  aria-expanded={Boolean(open)}
                  onClick={() => toggle(activity._id, Boolean(open))}
                  sx={[
                    {
                      ...rowSx,
                      // 8 px past the column on both sides, for its tint and ring, with its words
                      // where a row that opens nothing has them (#882).
                      width: 'calc(100% + 16px)',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      px: 1,
                      mx: -1,
                      borderRadius: '10px',
                      bgcolor: open ? 'tint.brand' : undefined,
                      '&:hover': { bgcolor: open ? 'tint.brand' : 'action.hover' },
                    },
                    keyboardFocusRing,
                  ]}
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
      {olderFailed && (
        <Typography
          role="alert"
          variant="body2"
          sx={{ color: 'status.negative', textAlign: 'center' }}
        >
          Couldn’t load older activity. The events shown are still here.
        </Typography>
      )}
      {hasOlder && (
        <Button
          variant="text"
          disabled={loadingOlder}
          onClick={() => void setSize((data?.length ?? 0) + 1)}
          sx={{ alignSelf: 'center' }}
        >
          {loadingOlder
            ? 'Loading older activity…'
            : olderFailed
              ? 'Try loading older activity'
              : 'Load older activity'}
        </Button>
      )}
    </Stack>
  );

  const card =
    openBatch && opened ? (
      <BatchPaymentCard
        key={opened._id}
        words={wordsOf(openBatch)}
        recordedBy={opened.actor}
        recordedAt={opened.createdAt}
        viewerId={viewerId}
        headingRef={cardHeadingRef}
        onClose={closeCard}
      />
    ) : openRecord && opened ? (
      <PaymentRecordCard
        key={opened._id}
        record={openRecord}
        recordedBy={opened.actor}
        recordedAt={opened.createdAt}
        viewerId={viewerId}
        headingRef={cardHeadingRef}
        onClose={closeCard}
      />
    ) : null;

  // The list keeps its place in the tree whether a card is open or not: drawn again, its rows
  // would lose keyboard focus as the card opens and closes (#852).
  return (
    <Box
      sx={
        card
          ? {
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 380px' },
              alignItems: 'start',
            }
          : undefined
      }
    >
      {/* Its place beside a card is set before one opens, so focus never lands on a card that
          is about to move. */}
      <Box sx={{ order: { xs: 2, md: 1 }, minWidth: 0 }}>{list}</Box>
      {card && (
        <Box sx={{ order: { xs: 1, md: 2 }, position: { md: 'sticky' }, top: { md: 88 } }}>
          {card}
        </Box>
      )}
    </Box>
  );
}
