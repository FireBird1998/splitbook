'use client';

import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  readGroupInsightsByTag,
  type GroupInsightsRead,
} from '@splitbook/shared/group-insights-read';
import SegmentedControl from '@/components/charts/SegmentedControl';
import {
  HomeCard,
  HomeCardBody,
  HomeCardEmpty,
  HomeCardError,
  HomeCardLoading,
} from '@/components/dashboard/HomeCard';
import { monthLabel } from '@/components/dashboard/spending-chart';
import { visuallyHidden } from './a11y';
import { byTagModel, type ByTagModel, type InsightsCardState } from './insights-cards';

/*
 * "By Tag" on a Group's Insights tab (#315, design canvas "Web portal", Group insights): the
 * Month's spending per Tag as bars in the one series colour, each with a tick at that Tag's own
 * average of the earlier Months (never the Month itself), the % change beside it, and a
 * Chart/Table switch. The table is what assistive technology reads in either view; the bars
 * are hidden from it.
 */

const CARD_ID = 'by-tag';

export type ByTagView = 'chart' | 'table';

export interface ByTagCardProps {
  /** The read for the Month the tab shows; undefined while it loads or when it failed. */
  read: GroupInsightsRead | undefined;
  state: InsightsCardState;
  onRetry: () => void;
  initialView?: ByTagView;
}

export default function ByTagCard({ read, state, onRetry, initialView = 'chart' }: ByTagCardProps) {
  const [view, setView] = useState<ByTagView>(initialView);
  const part = useMemo(
    () => (read && state === 'ready' ? readGroupInsightsByTag(read) : null),
    [read, state],
  );
  const model = useMemo(
    () => (read && part?.ok ? byTagModel(read, part.value) : null),
    [read, part],
  );
  // Only this card fails when its own data is malformed.
  const shown: InsightsCardState = state === 'ready' && !model ? 'failed' : state;
  const hasRows = Boolean(model && model.rows.length > 0);

  return (
    <HomeCard
      id={CARD_ID}
      title="By Tag"
      width="narrow"
      subtitle={model ? model.subtitle : undefined}
      aside={
        model && hasRows ? (
          <SegmentedControl
            label="Show Tags as"
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
      {shown === 'ready' && model && read ? (
        hasRows ? (
          <HomeCardBody>
            {view === 'chart' ? (
              <>
                <TagBars model={model} />
                <TagTable model={model} hidden />
              </>
            ) : (
              <TagTable model={model} />
            )}
          </HomeCardBody>
        ) : (
          <HomeCardEmpty
            title={`Nothing spent in ${monthLabel(read.month, 'long')}`}
            description="Nor in the months before it. Each Tag’s spending shows here once there is some."
          />
        )
      ) : shown === 'empty' ? (
        <HomeCardEmpty
          title="No Expenses yet"
          description="Each Tag’s spending in the month shows here, against its own average."
        />
      ) : shown === 'failed' ? (
        <HomeCardError message="Spending by Tag could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading spending by Tag" blocks={4} height={36} />
      )}
    </HomeCard>
  );
}

/** One series colour for the Month; the average is a tick in a text colour, never a hue. */
function TagBars({ model }: { model: ByTagModel }) {
  return (
    <Box aria-hidden="true" data-testid="tag-bars">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {model.rows.map((row) => (
          <Box
            key={row.key}
            data-testid="tag-bar-row"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto 56px',
              gridTemplateRows: 'auto 12px',
              alignItems: 'center',
              columnGap: 1.5,
              rowGap: 0.75,
              minHeight: 48,
              py: 0.5,
            }}
          >
            <Typography
              noWrap
              title={row.name}
              sx={{
                fontSize: '0.875rem',
                color: row.untagged ? 'text.secondary' : 'text.primary',
                fontStyle: row.untagged ? 'italic' : 'normal',
              }}
            >
              {row.name}
            </Typography>
            <Box
              component="span"
              sx={(theme) => ({
                ...theme.typography.money,
                fontSize: '0.8125rem',
                color: 'text.primary',
                whiteSpace: 'nowrap',
              })}
            >
              {row.spentText}
            </Box>
            <Box
              component="span"
              sx={(theme) => ({
                ...theme.typography.money,
                fontSize: '0.8125rem',
                color: 'text.secondary',
                textAlign: 'right',
                whiteSpace: 'nowrap',
              })}
            >
              {row.changeText}
            </Box>
            <Box sx={{ gridColumn: '1 / -1', position: 'relative', height: 12 }}>
              <Box
                data-testid="tag-bar"
                sx={{
                  position: 'absolute',
                  inset: '0 auto 0 0',
                  width: `${row.bar}%`,
                  bgcolor: 'chart.series',
                  borderRadius: '0 4px 4px 0',
                }}
              />
              {row.tick === null ? null : (
                <Box
                  data-testid="tag-average-tick"
                  sx={(theme) => ({
                    position: 'absolute',
                    top: -4,
                    bottom: -4,
                    left: `${row.tick}%`,
                    width: 2,
                    ml: '-1px',
                    borderRadius: '1px',
                    bgcolor: 'text.secondary',
                    // A ring in the card's colour keeps the tick clear of the bar under it.
                    boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
                  })}
                />
              )}
            </Box>
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 16px',
          mt: 1.75,
          fontSize: '0.78125rem',
          color: 'text.secondary',
        }}
      >
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box
            component="span"
            sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: 'chart.series' }}
          />
          {model.monthName}
        </Box>
        {model.averageName ? (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="span"
              sx={{ width: 2, height: 14, borderRadius: '1px', bgcolor: 'text.secondary' }}
            />
            {model.averageName}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * The same numbers as the bars: a row per Tag with the Month, the average and the change.
 * Hidden, it is what assistive technology reads in the Chart view. Shown, it scrolls sideways
 * inside the card when it must, and takes focus so the keyboard can scroll it.
 */
function TagTable({ model, hidden = false }: { model: ByTagModel; hidden?: boolean }) {
  const cell = {
    py: 1.25,
    px: 0.75,
    borderBottom: 1,
    borderColor: 'divider',
    textAlign: 'left',
    '&:first-of-type': { pl: 0 },
    '&:last-of-type': { pr: 0 },
  } as const;
  const number = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' } as const;
  const money = (theme: { typography: { money: object } }) => ({ ...theme.typography.money });
  const withAverage = model.averageName !== null;
  const frame = hidden
    ? { sx: visuallyHidden }
    : {
        role: 'region',
        'aria-label': 'Spending by Tag table',
        tabIndex: 0,
        sx: {
          overflowX: 'auto',
          borderRadius: 1,
          '&:focus-visible': { outline: 2, outlineColor: 'focus.main', outlineOffset: 2 },
        },
      };
  return (
    <Box {...frame}>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          '& thead th': {
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
          },
          '& tbody tr:last-of-type > *': { borderBottom: 0 },
        }}
      >
        <Box component="caption" sx={visuallyHidden}>
          {model.caption}
        </Box>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={cell}>
              Tag
            </Box>
            <Box component="th" scope="col" sx={number}>
              {model.monthName}
            </Box>
            {withAverage ? (
              <>
                <Box component="th" scope="col" sx={number}>
                  {model.averageName}
                </Box>
                <Box component="th" scope="col" sx={number}>
                  Change
                </Box>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.key}>
              <Box
                component="th"
                scope="row"
                sx={{
                  ...cell,
                  fontWeight: 400,
                  color: row.untagged ? 'text.secondary' : 'text.primary',
                  fontStyle: row.untagged ? 'italic' : 'normal',
                  overflowWrap: 'anywhere',
                }}
              >
                {row.name}
              </Box>
              <Box component="td" sx={[number, money, { color: 'text.primary' }]}>
                {row.spentText}
              </Box>
              {withAverage ? (
                <>
                  <Box component="td" sx={[number, money, { color: 'text.secondary' }]}>
                    {row.averageText ?? '–'}
                  </Box>
                  <Box component="td" sx={[number, money, { color: 'text.secondary' }]}>
                    {row.changeText}
                  </Box>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
