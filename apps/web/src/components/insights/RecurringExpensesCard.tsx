'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import CheckIcon from '@mui/icons-material/Check';
import {
  readGroupInsightsRecurring,
  type GroupInsightsRead,
} from '@splitbook/shared/group-insights-read';
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardError,
  HomeCardLoading,
  HomeList,
} from '@/components/dashboard/HomeCard';
import { groupSettingsHref } from '@/components/groups/group-tabs';
import { RADIUS } from '@/lib/theme/tokens';
import { recurringModel, type InsightsCardState, type RecurringModel } from './insights-cards';

/*
 * "Recurring Expenses" on a Group's Insights tab (#315, design canvas "Web portal", Group
 * insights): each template's amount, schedule and who pays it, the day it added an Expense this
 * Month, and its next date. Admins, who alone change templates, get Manage, to where they are
 * managed: the Recurring section of the Group's settings. Other members are told who can.
 *
 * Recurring Expenses are one product-wide switch (#289), never one per Group. The tab renders
 * this card only while the switch is on (and for a Theme that has recurring Expenses): while it
 * is off there is no heading, no empty state and no link, and the read sends no recurring data.
 */

const CARD_ID = 'recurring-expenses';

/** Where recurring Expenses are managed on the web: the Group settings' Recurring section. */
export function manageRecurringHref(groupId: string): string {
  return `${groupSettingsHref(groupId)}#recurring-expenses`;
}

export interface RecurringExpensesCardProps {
  groupId: string;
  /** The signed-in member, who reads as "You". */
  userId: string;
  /** The viewer's current Month: a date in another year carries its year. */
  currentMonth: string;
  /** The viewer is one of the Group's admins, who alone change recurring Expenses. */
  canManage: boolean;
  /** The read for the Month the tab shows; undefined while it loads or when it failed. */
  read: GroupInsightsRead | undefined;
  state: InsightsCardState;
  onRetry: () => void;
}

export default function RecurringExpensesCard({
  groupId,
  userId,
  currentMonth,
  canManage,
  read,
  state,
  onRetry,
}: RecurringExpensesCardProps) {
  // Templates aren't Expenses: a Group with none yet ('empty') can still have them.
  const loaded = read && (state === 'ready' || state === 'empty') ? read : null;
  const part = useMemo(() => (loaded ? readGroupInsightsRecurring(loaded) : undefined), [loaded]);
  const model = useMemo(
    () =>
      loaded && part?.ok ? recurringModel(loaded, part.value, { userId, currentMonth }) : null,
    [loaded, part, userId, currentMonth],
  );
  // The read says recurring Expenses are off: nothing at all, not even the heading.
  if (part === null) return null;
  // Only this card fails when its own data is malformed.
  const shown: 'ready' | 'loading' | 'failed' = model
    ? 'ready'
    : loaded || state === 'failed'
      ? 'failed'
      : 'loading';

  return (
    <HomeCard
      id={CARD_ID}
      title="Recurring Expenses"
      width="narrow"
      subtitle={model ? model.subtitle : undefined}
      aside={
        canManage ? (
          <Button
            component={Link}
            href={manageRecurringHref(groupId)}
            variant="text"
            aria-label="Manage recurring Expenses"
          >
            Manage
          </Button>
        ) : null
      }
    >
      {shown === 'ready' && model ? (
        <>
          {model.rows.length > 0 ? (
            <TemplateList model={model} />
          ) : (
            <HomeCardEmpty
              title="No recurring Expenses yet"
              description={
                canManage
                  ? 'Add rent, Wi-Fi or another monthly Expense in the Group’s settings, and each shows here with its next date.'
                  : 'When an admin adds rent, Wi-Fi or another monthly Expense, each shows here with its next date.'
              }
            />
          )}
          {canManage || model.rows.length === 0 ? null : (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ px: 2.5, pt: 1.25, pb: 1, borderTop: 1, borderColor: 'divider' }}
            >
              Only the Group’s admins can change recurring Expenses.
            </Typography>
          )}
        </>
      ) : shown === 'failed' ? (
        <HomeCardError message="Recurring Expenses could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading recurring Expenses" blocks={2} height={56} />
      )}
    </HomeCard>
  );
}

const small = { fontSize: '0.75rem', lineHeight: 1.4 } as const;

/** A row per template, as the canvas's .lrow: its icon, then three lines. */
function TemplateList({ model }: { model: RecurringModel }) {
  return (
    <HomeList label="Recurring Expenses">
      {model.rows.map((row) => (
        <Box
          component="li"
          key={row.id}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            minHeight: 60,
            px: 2.5,
            py: 1,
            '& + &': { borderTop: 1, borderColor: 'divider' },
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              width: 36,
              height: 36,
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: `${RADIUS.md}px`,
              bgcolor: row.paused ? 'surface.muted' : 'tint.brand',
              color: row.paused ? 'text.secondary' : 'primary.main',
            }}
          >
            <AutorenewIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 1.5,
              }}
            >
              <Typography
                component="span"
                noWrap
                title={row.description}
                sx={{ fontWeight: 600, fontSize: '0.875rem', color: 'text.primary' }}
              >
                {row.description}
              </Typography>{' '}
              <Box
                component="span"
                sx={(theme) => ({
                  ...theme.typography.money,
                  fontSize: '0.875rem',
                  color: 'text.primary',
                  whiteSpace: 'nowrap',
                })}
              >
                {row.amountText}
              </Box>
            </Box>{' '}
            {/* Spaces between the pieces, which flex lays out apart, so they never read run together. */}
            <Typography component="span" sx={{ ...small, color: 'text.secondary' }}>
              {row.schedule}
            </Typography>{' '}
            <Box
              sx={{
                ...small,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '2px 12px',
              }}
            >
              {row.added ? (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    color: 'status.positive',
                  }}
                >
                  <CheckIcon aria-hidden="true" sx={{ fontSize: 16 }} />
                  {row.added}
                </Box>
              ) : (
                <span />
              )}{' '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {row.next}
              </Box>
            </Box>
          </Box>
        </Box>
      ))}
    </HomeList>
  );
}
