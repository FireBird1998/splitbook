'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import {
  readGroupInsightsWhoPaid,
  type GroupInsightsRead,
} from '@splitbook/shared/group-insights-read';
import { PersonAvatar } from '@/components/balances/TabCard';
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardError,
  HomeCardLoading,
} from '@/components/dashboard/HomeCard';
import { groupTabHref } from '@/components/groups/group-tabs';
import { visuallyHidden } from './a11y';
import { whoPaidModel, type InsightsCardState, type WhoPaidModel } from './insights-cards';

/*
 * "Who paid this month" on a Group's Insights tab (#315, design canvas "Web portal", Group
 * insights): each member's Paid against their Share for the Month, exact, as a table whose
 * rows carry a bar for what they paid and a tick at their share (one series colour, the
 * comparison in a text colour), and the Month net, Paid minus Share. The table is the figures;
 * the bars beside them are hidden from assistive technology. The word is Paid, never "fronted".
 */

const CARD_ID = 'who-paid';

export interface WhoPaidCardProps {
  groupId: string;
  /** The signed-in member, who reads as "You". */
  userId: string;
  /** The read for the Month the tab shows; undefined while it loads or when it failed. */
  read: GroupInsightsRead | undefined;
  state: InsightsCardState;
  onRetry: () => void;
}

export default function WhoPaidCard({ groupId, userId, read, state, onRetry }: WhoPaidCardProps) {
  const model = useMemo(() => {
    if (!read || state !== 'ready') return null;
    const part = readGroupInsightsWhoPaid(read);
    return part.ok ? whoPaidModel(read, part.value, { userId }) : null;
  }, [read, state, userId]);
  // Only this card fails when its own data is malformed.
  const shown: InsightsCardState = state === 'ready' && !model ? 'failed' : state;
  const table = model && !model.nothingSpent ? model : null;

  return (
    <HomeCard
      id={CARD_ID}
      title="Who paid this month"
      subtitle={model ? model.subtitle : undefined}
      aside={table ? <Legend /> : null}
    >
      {shown === 'ready' && model ? (
        table ? (
          <>
            <PaidTable model={table} />
            <Box sx={{ borderTop: 1, borderColor: 'divider' }} />
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '4px 12px',
                pt: 1.25,
                pr: 1.5,
                pl: 2.5,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                A Month net is what someone paid minus their share, in this month alone. Balances
                run across every month.
              </Typography>
              <Button component={Link} href={groupTabHref(groupId, 'balances')} variant="text">
                See Balances
              </Button>
            </Box>
          </>
        ) : (
          <HomeCardEmpty
            title={`Nothing paid in ${model.monthLong}`}
            description="Once the month has Expenses, what each member paid against their share shows here."
          />
        )
      ) : shown === 'empty' ? (
        <HomeCardEmpty
          title="No Expenses yet"
          description="What each member paid in the month, against their share, shows here."
        />
      ) : shown === 'failed' ? (
        <HomeCardError message="Who paid this month could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading who paid this month" blocks={3} height={40} />
      )}
    </HomeCard>
  );
}

/** What the bars and ticks mean: the canvas's legend, beside the title. */
function Legend() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        display: { xs: 'none', sm: 'flex' },
        flexWrap: 'wrap',
        gap: '6px 16px',
        fontSize: '0.78125rem',
        color: 'text.secondary',
      }}
    >
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          component="span"
          sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: 'chart.series' }}
        />
        Paid
      </Box>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          component="span"
          sx={{ width: 2, height: 14, borderRadius: '1px', bgcolor: 'text.secondary' }}
        />
        Share
      </Box>
    </Box>
  );
}

const netColor = {
  positive: 'status.positive',
  negative: 'status.negative',
  neutral: 'text.primary',
};

/**
 * A row per person: their name, a bar for what they paid with a tick at their share (hidden
 * from assistive technology, and on a phone), then Paid, Share and the Month net. It scrolls
 * sideways inside the card when it must, and takes focus so the keyboard can scroll it.
 */
function PaidTable({ model }: { model: WhoPaidModel }) {
  const money = (theme: { typography: { money: object } }) => ({ ...theme.typography.money });
  return (
    <Box
      role="region"
      aria-label="Who paid this month table"
      tabIndex={0}
      sx={{
        overflowX: 'auto',
        pb: 0.5,
        '&:focus-visible': { outline: 2, outlineColor: 'focus.main', outlineOffset: -2 },
      }}
    >
      <Box
        component="table"
        sx={{
          width: '100%',
          minWidth: { xs: 0, sm: 560 },
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          color: 'text.primary',
          '& th, & td': {
            px: 1.5,
            py: 1.25,
            borderBottom: 1,
            borderColor: 'divider',
            verticalAlign: 'middle',
            textAlign: 'left',
          },
          '& thead th, & thead td': {
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
          },
          '& tbody tr:last-of-type > *': { borderBottom: 0 },
          '& tr > :first-of-type': { pl: 2.5 },
          '& tr > :last-of-type': { pr: 2.5 },
          '& .num': { textAlign: 'right', whiteSpace: 'nowrap' },
          '& .bar': { display: { xs: 'none', sm: 'table-cell' }, width: '40%' },
        }}
      >
        <Box component="caption" sx={visuallyHidden}>
          {model.caption}
        </Box>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <td className="bar" aria-hidden="true" />
            <th scope="col" className="num">
              Paid
            </th>
            <th scope="col" className="num">
              Share
            </th>
            <th scope="col" className="num">
              Month net
            </th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.id}>
              <Box component="th" scope="row" sx={{ fontWeight: 600 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <PersonAvatar name={row.avatarName} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
                      {row.name}
                    </Box>{' '}
                    {row.former ? (
                      <Box
                        component="span"
                        sx={{ fontSize: '0.75rem', fontWeight: 400, color: 'text.secondary' }}
                      >
                        No longer in the Group
                      </Box>
                    ) : null}
                  </Box>
                </Box>
              </Box>
              <td className="bar" aria-hidden="true">
                <Box sx={{ position: 'relative', height: 12 }} data-testid="paid-bar">
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: '0 auto 0 0',
                      width: `${row.bar}%`,
                      bgcolor: 'chart.series',
                      borderRadius: '0 4px 4px 0',
                    }}
                  />
                  <Box
                    data-testid="share-tick"
                    sx={(theme) => ({
                      position: 'absolute',
                      top: -4,
                      bottom: -4,
                      left: `${row.tick}%`,
                      width: 2,
                      ml: '-1px',
                      borderRadius: '1px',
                      bgcolor: 'text.secondary',
                      boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
                    })}
                  />
                </Box>
              </td>
              <Box component="td" className="num" sx={money}>
                {row.paidText}
              </Box>
              <Box component="td" className="num" sx={[money, { color: 'text.secondary' }]}>
                {row.shareText}
              </Box>
              <td className="num">
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '1px',
                  }}
                >
                  <Box
                    component="span"
                    sx={[money, { fontWeight: 600, color: netColor[row.netTone] }]}
                  >
                    {row.netText}
                  </Box>{' '}
                  <Box component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {row.netNote}
                  </Box>
                </Box>
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
