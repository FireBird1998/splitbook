'use client';

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { PositionStanding } from '@splitbook/shared/member-positions';
import type { SettlementLedger } from '@splitbook/shared/settlement-preview';
import ErrorState from '@/components/common/ErrorState';
import SegmentedControl from '@/components/charts/SegmentedControl';
import { TabCard, PersonAvatar, visuallyHidden } from './TabCard';
import {
  everyoneModel,
  POSITION_WORDS,
  type EveryoneModel,
  type EveryonePerson,
  type EveryoneRow,
  type PhrasePart,
} from './everyone-chart';

/*
 * Balances' "Everyone" (#313, design canvas "Web portal", GroupBalances): each person's
 * all-time net as a diverging bar, owed to the right and owes to the left, with a tooltip, and
 * a Chart/Table switch whose table also says who settles with whom. The table is what assistive
 * technology reads in either view; the chart is hidden from it. One currency at a time: the
 * tab's currency switch picks it in a Group that still mixes currencies.
 */

export type EveryoneState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; ledger: SettlementLedger };

export type EveryoneView = 'chart' | 'table';

interface EveryoneCardProps {
  state: EveryoneState;
  currency: string;
  /** The signed-in member, who reads as "You". */
  viewerId: string;
  /** Names for everyone the ledger may mention, members first in the tab's order. */
  people: readonly EveryonePerson[];
  onRetry: () => void;
  /** The view shown first. */
  initialView?: EveryoneView;
}

const HEADING_ID = 'everyone-heading';

/** A bar's colour, from the diverging chart tokens: owed positive, owes negative. */
const BAR_COLOR: Record<Exclude<PositionStanding, 'settled'>, string> = {
  owed: 'diverging.positive',
  owes: 'diverging.negative',
};
/** A net's colour in the table: the status text colours, readable at 4.5:1. */
const AMOUNT_COLOR: Record<PositionStanding, string> = {
  owed: 'status.positive',
  owes: 'status.negative',
  settled: 'text.secondary',
};

/** Three columns once the chart is this wide: who, the bar, the amount. Narrower, two rows. */
const WIDE = '@container (min-width: 480px)';
const COLUMNS = 'minmax(120px, 170px) minmax(0, 1fr) minmax(96px, auto)';

export default function EveryoneCard({
  state,
  currency,
  viewerId,
  people,
  onRetry,
  initialView = 'chart',
}: EveryoneCardProps) {
  const [view, setView] = useState<EveryoneView>(initialView);
  const model = modelOf(state, { currency, viewerId, people });
  const shown = model && !model.settled ? model : null;

  return (
    <TabCard
      headingId={HEADING_ID}
      title="Everyone"
      subtitle={`All-time net · ${currency}`}
      aside={
        shown ? (
          <SegmentedControl
            label="View as"
            value={view}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
            onChange={setView}
          />
        ) : null
      }
    >
      {state.status === 'loading' ? (
        <Box
          role="status"
          aria-label="Loading everyone’s positions"
          sx={{ px: 2.5, pb: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} variant="rounded" height={40} aria-hidden />
          ))}
        </Box>
      ) : !model ? (
        <Box sx={{ px: 2.5, pb: 2.5 }}>
          <ErrorState
            severity="warning"
            message="Everyone’s positions could not be loaded."
            onRetry={onRetry}
          />
        </Box>
      ) : !shown ? (
        <Typography sx={{ m: 0, px: 2.5, pb: 2.5, fontSize: '0.875rem', color: 'text.secondary' }}>
          Everyone is settled up in {currency}. Positions show here when someone owes.
        </Typography>
      ) : view === 'chart' ? (
        <Box sx={{ px: 2.5, pb: 2.5 }}>
          <DivergingBars model={shown} />
          <Box sx={visuallyHidden}>
            <EveryoneTable model={shown} />
          </Box>
        </Box>
      ) : (
        <Box
          role="region"
          aria-label="Everyone table"
          tabIndex={0}
          sx={{
            // Positioned, so the cells' visually hidden text is clipped here when the columns
            // scroll out of view, and never widens the page.
            position: 'relative',
            overflowX: 'auto',
            pb: 1,
            borderBottomLeftRadius: '16px',
            borderBottomRightRadius: '16px',
            '&:focus-visible': { outline: 2, outlineColor: 'focus.main', outlineOffset: -2 },
          }}
        >
          <EveryoneTable model={shown} />
        </Box>
      )}
    </TabCard>
  );
}

/** The figures to show, or null while loading, after a failed read, or when they don't add up. */
function modelOf(
  state: EveryoneState,
  options: Parameters<typeof everyoneModel>[1],
): EveryoneModel | null {
  if (state.status !== 'ready') return null;
  try {
    return everyoneModel(state.ledger, options);
  } catch {
    return null;
  }
}

/** A sentence with its amounts in the money font. */
function Phrase({ parts }: { parts: readonly PhrasePart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.money ? (
          <Box
            component="span"
            key={index}
            sx={(theme) => ({ ...theme.typography.money, whiteSpace: 'nowrap' })}
          >
            {part.text}
          </Box>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** A square of a bar's colour beside its meaning: web.css .legend. */
function LegendKey({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box
        component="span"
        sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: color, flex: 'none' }}
      />
      {children}
    </Box>
  );
}

/** What hovering a bar shows: the person, their position and who settles with them. */
function BarTip({ row }: { row: EveryoneRow }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <Box component="span" sx={{ fontWeight: 600 }}>
        {row.name}
      </Box>
      {row.standing === 'settled' ? (
        <span>Settled up</span>
      ) : (
        <span>
          <Phrase parts={[{ text: row.amount, money: true }]} /> · {row.position.toLowerCase()}
        </span>
      )}
      {row.settledBy.length ? (
        <span>
          <Phrase parts={row.settledBy} />
        </span>
      ) : null}
    </Box>
  );
}

/**
 * The bars (web.css .diverge, .dv): a row per person with their name, their bar either side of
 * a centre line, and their exact amount and position in words, so colour is never the only
 * cue. Hidden from assistive technology, which reads the table instead.
 */
function DivergingBars({ model }: { model: EveryoneModel }) {
  return (
    <Box aria-hidden="true" data-testid="everyone-chart" sx={{ containerType: 'inline-size' }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 16px',
          mb: 1.75,
          fontSize: '0.78125rem',
          color: 'text.secondary',
        }}
      >
        <LegendKey color={BAR_COLOR.owes}>{POSITION_WORDS.owes}</LegendKey>
        <LegendKey color={BAR_COLOR.owed}>{POSITION_WORDS.owed}</LegendKey>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {model.rows.map((row) => (
          <Box
            key={row.userId}
            data-testid="everyone-row"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gridTemplateAreas: '"who value" "track track"',
              alignItems: 'center',
              gap: '4px 12px',
              [WIDE]: {
                gridTemplateColumns: COLUMNS,
                gridTemplateAreas: '"who track value"',
                minHeight: 40,
              },
            }}
          >
            <Box
              sx={{
                gridArea: 'who',
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                minWidth: 0,
              }}
            >
              <PersonAvatar name={row.avatarName} />
              <Typography
                noWrap
                sx={{ m: 0, fontSize: '0.875rem', fontWeight: 600, color: 'text.primary' }}
              >
                {row.name}
              </Typography>
            </Box>
            <Tooltip
              followCursor
              disableInteractive
              placement="top"
              title={<BarTip row={row} />}
              slotProps={{
                tooltip: {
                  sx: {
                    bgcolor: 'inverse.bg',
                    color: 'inverse.text',
                    borderRadius: '10px',
                    px: 1.25,
                    py: 1,
                    boxShadow: 2,
                    fontSize: '0.78125rem',
                    fontWeight: 400,
                    lineHeight: 1.45,
                    maxWidth: 320,
                  },
                },
              }}
            >
              <Box
                data-testid="everyone-track"
                sx={{ gridArea: 'track', display: 'flex', alignItems: 'center', minHeight: 28 }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    flex: '1 1 auto',
                    height: 14,
                    // The zero line, through every row.
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      left: '50%',
                      top: '-8px',
                      bottom: '-8px',
                      width: '1px',
                      bgcolor: 'border.strong',
                    },
                  }}
                >
                  {row.standing !== 'settled' ? (
                    <Box
                      data-testid="everyone-bar"
                      data-standing={row.standing}
                      sx={{
                        position: 'absolute',
                        top: '1px',
                        bottom: '1px',
                        width: `${row.barWidth}%`,
                        bgcolor: BAR_COLOR[row.standing],
                        ...(row.standing === 'owes'
                          ? { right: '50%', mr: '1px', borderRadius: '4px 0 0 4px' }
                          : { left: '50%', ml: '1px', borderRadius: '0 4px 4px 0' }),
                      }}
                    />
                  ) : null}
                </Box>
              </Box>
            </Tooltip>
            <Box
              data-testid="everyone-amount"
              sx={{
                gridArea: 'value',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                textAlign: 'right',
              }}
            >
              {row.standing === 'settled' ? (
                <Typography sx={{ m: 0, fontSize: '0.875rem', color: 'text.secondary' }}>
                  {row.position}
                </Typography>
              ) : (
                <>
                  <Box
                    component="span"
                    sx={(theme) => ({
                      ...theme.typography.money,
                      fontSize: '1rem',
                      color: 'text.primary',
                      whiteSpace: 'nowrap',
                    })}
                  >
                    {row.amount}
                  </Box>
                  <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
                    {row.position.toLowerCase()}
                  </Typography>
                </>
              )}
            </Box>
          </Box>
        ))}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateAreas: '"track"',
            columnGap: '12px',
            [WIDE]: { gridTemplateColumns: COLUMNS, gridTemplateAreas: '". track ."' },
          }}
        >
          <Box
            data-testid="everyone-scale"
            sx={(theme) => ({
              ...theme.typography.money,
              gridArea: 'track',
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              fontSize: '0.71875rem',
              color: 'text.disabled',
              '& > :last-child': { textAlign: 'right' },
            })}
          >
            <span>{model.scale.negative}</span>
            <span>0</span>
            <span>{model.scale.positive}</span>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The same figures as the bars, and who settles with whom: what assistive technology reads in
 * either view, and what the Table view shows.
 */
function EveryoneTable({ model }: { model: EveryoneModel }) {
  return (
    <Box
      component="table"
      sx={{
        width: '100%',
        minWidth: 560,
        borderCollapse: 'collapse',
        fontSize: '0.875rem',
        color: 'text.primary',
        '& th, & td': {
          textAlign: 'left',
          px: 1.5,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
          verticalAlign: 'middle',
        },
        '& thead th': {
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'text.secondary',
          whiteSpace: 'nowrap',
        },
        '& tbody th, & tbody td': { height: 56 },
        '& tbody tr:last-of-type > *': { borderBottom: 0 },
        '& tbody tr:hover > *': { bgcolor: 'surface.hover' },
        '& tr > :first-of-type': { pl: 2.5 },
        '& tr > :last-of-type': { pr: 2.5 },
        '& .num': { textAlign: 'right', whiteSpace: 'nowrap' },
      }}
    >
      <Box component="caption" sx={visuallyHidden}>
        Everyone’s all-time net in {model.currency}, and who settles with whom
      </Box>
      <thead>
        <tr>
          <th scope="col">Member</th>
          <th scope="col" className="num">
            All-time net
          </th>
          <th scope="col">Position</th>
          <th scope="col">Settled by</th>
        </tr>
      </thead>
      <tbody>
        {model.rows.map((row) => (
          <tr key={row.userId}>
            <Box component="th" scope="row" sx={{ fontWeight: 600 }}>
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1.25,
                  whiteSpace: 'nowrap',
                }}
              >
                <PersonAvatar name={row.avatarName} />
                <span>{row.name}</span>
              </Box>
            </Box>
            <Box
              component="td"
              className="num"
              sx={(theme) => ({
                ...theme.typography.money,
                fontWeight: 600,
                color: AMOUNT_COLOR[row.standing],
              })}
            >
              {row.amount}
            </Box>
            <Box component="td" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {row.position}
            </Box>
            <Box component="td" sx={{ color: 'text.secondary' }}>
              {row.settledBy.length ? (
                <Phrase parts={row.settledBy} />
              ) : (
                <>
                  <Box component="span" aria-hidden sx={{ color: 'text.disabled' }}>
                    —
                  </Box>
                  <Box component="span" sx={visuallyHidden}>
                    Nobody
                  </Box>
                </>
              )}
            </Box>
          </tr>
        ))}
      </tbody>
    </Box>
  );
}
