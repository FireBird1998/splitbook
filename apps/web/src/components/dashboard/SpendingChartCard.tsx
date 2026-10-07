'use client';

import { createContext, useCallback, useContext, useId, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartsTooltipContainer, useAxesTooltip } from '@mui/x-charts/ChartsTooltip';
import { SPENDING_MONTHS } from '@splitbook/shared/insights';
import type { UserSpendingRead } from '@splitbook/shared/user-spending-read';
import MoneyText from '@/components/common/MoneyText';
import SegmentedControl from '@/components/charts/SegmentedControl';
import { HomeCard, HomeCardBody, HomeCardEmpty, HomeCardError, HomeCardLoading } from './HomeCard';
import { useHomeSpending } from './home-reads';
import {
  compactMoney,
  spendingChartModel,
  valueAxis,
  type SpendingChartModel,
  type SpendingMonthRow,
} from './spending-chart';

/*
 * Home's "Your share of spending" (#307, design canvas "Web portal"): six Months of the member's
 * share across their Groups as columns, one currency at a time, the current Month in the series
 * colour, a tooltip with each Group's part, and a Chart/Table switch. The table is what
 * assistive technology reads in either view; the chart is hidden from it.
 */

/** The card's region is labelled by its heading, `spending-heading`. */
const CARD_ID = 'spending';
const PLOT_HEIGHT = 220;
const Y_AXIS_WIDTH = 56;
const RIGHT_MARGIN = 8;
/** The canvas's thin marks: 24 px columns, never more than 70% of a Month's band. */
const BAR_WIDTH = 24;
const MIN_GAP_RATIO = 0.3;

/** Read by assistive technology, not shown. Pixel strings: in `sx`, 1 means 100% and -1 a spacing step. */
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

export default function SpendingChartCard() {
  const { read, failed, retry } = useHomeSpending();
  return <SpendingChartView read={read} failed={failed} onRetry={retry} />;
}

export type SpendingView = 'chart' | 'table';

interface SpendingChartViewProps {
  /** Undefined while the first read is loading. */
  read: UserSpendingRead | undefined;
  failed: boolean;
  onRetry: () => void;
  /** The view shown first. */
  initialView?: SpendingView;
}

/** The card for a read, a failed read or one still loading. */
export function SpendingChartView({
  read,
  failed,
  onRetry,
  initialView = 'chart',
}: SpendingChartViewProps) {
  const [chosenCurrency, setCurrency] = useState<string>();
  const [view, setView] = useState<SpendingView>(initialView);
  const model = useMemo(
    () => (read ? spendingChartModel(read, chosenCurrency) : null),
    [read, chosenCurrency],
  );

  return (
    <HomeCard
      id={CARD_ID}
      title="Your share of spending"
      subtitle={`${model ? `${model.currency} · ` : ''}last ${SPENDING_MONTHS.default} months · every Group`}
      aside={
        model ? (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {model.currencies.length > 1 ? (
              <SegmentedControl
                label="Currency"
                value={model.currency}
                options={model.currencies.map((code) => ({ value: code, label: code }))}
                onChange={setCurrency}
              />
            ) : null}
            <SegmentedControl
              label="View as"
              value={view}
              options={[
                { value: 'chart', label: 'Chart' },
                { value: 'table', label: 'Table' },
              ]}
              onChange={setView}
            />
          </Stack>
        ) : null
      }
    >
      {model ? (
        <HomeCardBody>
          {view === 'chart' ? (
            <>
              <SpendingColumns model={model} />
              <SpendingTable model={model} hidden />
            </>
          ) : (
            <SpendingTable model={model} />
          )}
          {model.explanation ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.75 }}>
              {model.explanation}
            </Typography>
          ) : null}
        </HomeCardBody>
      ) : read ? (
        <HomeCardEmpty
          title="No spending yet"
          description="Your share of each Expense in your Groups will show here, month by month."
        />
      ) : failed ? (
        <HomeCardError message="Your spending could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading your spending" blocks={1} height={PLOT_HEIGHT} />
      )}
    </HomeCard>
  );
}

/** The Months a chart's tooltip describes. A context, so the tooltip's portal still sees them. */
const RowsContext = createContext<{ rows: SpendingMonthRow[]; currency: string } | null>(null);

function SpendingTooltip() {
  const axes = useAxesTooltip();
  const context = useContext(RowsContext);
  const row = axes?.[0] ? context?.rows[axes[0].dataIndex] : undefined;
  return (
    <ChartsTooltipContainer trigger="axis">
      {row && context ? (
        <Box
          sx={{
            bgcolor: 'inverse.bg',
            color: 'inverse.text',
            borderRadius: '10px',
            px: 1.25,
            py: 1,
            boxShadow: 2,
            fontSize: '0.78125rem',
            lineHeight: 1.45,
          }}
        >
          <Typography fontWeight={600} fontSize="inherit">
            {row.long}
          </Typography>
          <MoneyText
            amount={row.amount}
            currency={context.currency}
            tone="neutral"
            color="inherit"
            sx={{ display: 'block', fontSize: 'inherit' }}
          />
          {row.parts.length ? (
            row.parts.map((part) => (
              <Box
                key={part.groupId}
                sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
              >
                <span>{part.name}</span>
                <MoneyText
                  amount={part.amount}
                  currency={context.currency}
                  tone="neutral"
                  color="inherit"
                  sx={{ fontSize: 'inherit' }}
                />
              </Box>
            ))
          ) : (
            <span>No spending</span>
          )}
        </Box>
      ) : null}
    </ChartsTooltipContainer>
  );
}

/** One column per Month in the series colour family; the current Month in the full colour. */
/** An element's width, kept current as it resizes; null until it is measured in the browser. */
function useWidth() {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The gap between columns, as a share of each Month's band, that keeps columns 24 px wide. */
/** Each Month's share of the plot's width, or null until measured. */
function bandWidth(width: number | null, months: number): number | null {
  return width ? Math.max(0, (width - Y_AXIS_WIDTH - RIGHT_MARGIN) / months) : null;
}

/** The gap between columns, as a share of each Month's band, that keeps columns 24 px wide. */
function gapRatio(band: number | null): number {
  if (band === null) return 0.7;
  return band > 0 ? Math.max(MIN_GAP_RATIO, 1 - BAR_WIDTH / band) : MIN_GAP_RATIO;
}

/** About one character of the 11.5 px mono label: a figure wider than its band is shortened. */
const LABEL_CHARACTER_WIDTH = 7;

function SpendingColumns({ model }: { model: SpendingChartModel }) {
  const { palette, typography } = useTheme();
  const [measure, width] = useWidth();
  const band = bandWidth(width, model.rows.length);
  const axis = valueAxis(Math.max(...model.rows.map((row) => row.amount)));
  const lastRow = model.rows[model.rows.length - 1];
  // The current Month's figure above its column: exact when it fits, as on a phone it may not.
  const currentLabel =
    band === null || band >= lastRow.text.length * LABEL_CHARACTER_WIDTH
      ? lastRow.text
      : compactMoney(lastRow.amount, model.currency);
  const months = model.rows.map((row) => row.month);
  const last = model.rows.length - 1;
  const context = useMemo(
    () => ({ rows: model.rows, currency: model.currency }),
    [model.rows, model.currency],
  );
  return (
    <RowsContext.Provider value={context}>
      <Box ref={measure} aria-hidden="true" data-testid="spending-columns">
        <BarChart
          height={PLOT_HEIGHT}
          hideLegend
          skipAnimation
          borderRadius={4}
          grid={{ horizontal: true }}
          axisHighlight={{ x: 'none' }}
          margin={{ top: 24, right: RIGHT_MARGIN, bottom: 0, left: 0 }}
          series={[
            {
              id: 'share',
              label: 'Your share',
              data: model.rows.map((row) => row.amount),
              barLabel: (item) => (item.dataIndex === last ? currentLabel : null),
              barLabelPlacement: 'outside',
            },
          ]}
          xAxis={[
            {
              scaleType: 'band',
              data: months,
              valueFormatter: (month: string) =>
                model.rows.find((row) => row.month === month)?.short ?? month,
              categoryGapRatio: gapRatio(band),
              disableTicks: true,
              colorMap: {
                type: 'ordinal',
                values: months,
                colors: model.rows.map((row) =>
                  row.current ? palette.chart.series : palette.chart.seriesSoft,
                ),
              },
            },
          ]}
          yAxis={[
            {
              width: Y_AXIS_WIDTH,
              min: 0,
              max: axis.max,
              tickInterval: axis.ticks,
              disableLine: true,
              disableTicks: true,
              valueFormatter: (value: number) => compactMoney(value, model.currency),
            },
          ]}
          slots={{ tooltip: SpendingTooltip }}
          sx={{
            '& .MuiChartsAxis-tickLabel': { fontSize: '0.75rem' },
            '& .MuiChartsAxis-directionY .MuiChartsAxis-tickLabel': { fontSize: '0.71875rem' },
            '& .MuiBarLabel-root': {
              ...(typography.money as object),
              fill: palette.text.secondary,
              fontSize: '0.71875rem',
            },
          }}
        />
      </Box>
    </RowsContext.Provider>
  );
}

/**
 * The same numbers as the chart: a row per Month, a column per Group, then the member's share.
 * Hidden, it is what assistive technology reads in the Chart view. Shown, it scrolls sideways
 * inside the card when there are many Groups, and takes focus so the keyboard can scroll it.
 */
function SpendingTable({ model, hidden = false }: { model: SpendingChartModel; hidden?: boolean }) {
  const captionId = useId();
  const cell = {
    py: 1.25,
    px: 1.5,
    borderBottom: 1,
    borderColor: 'divider',
    textAlign: 'left',
  } as const;
  const number = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' } as const;
  const frame = hidden
    ? { sx: visuallyHidden }
    : {
        // Positioned, so the cells' visually hidden text is clipped here with the columns
        // scrolled out of view, and never widens the page.
        sx: { position: 'relative', overflowX: 'auto', borderRadius: 1 },
        tabIndex: 0,
        role: 'group',
        'aria-labelledby': captionId,
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
        <Box component="caption" id={captionId} sx={visuallyHidden}>
          Your share of spending in {model.currency}, by month, with each Group&apos;s part
        </Box>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={cell}>
              Month
            </Box>
            {model.groups.map((group) => (
              <Box component="th" scope="col" key={group.groupId} sx={{ ...number }}>
                {group.name}
              </Box>
            ))}
            <Box component="th" scope="col" sx={number}>
              Your share
            </Box>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.month}>
              <Box
                component="th"
                scope="row"
                sx={{
                  ...cell,
                  fontWeight: row.current ? 600 : 400,
                  color: 'text.primary',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.long}
                {row.current ? (
                  <Typography component="span" variant="caption" color="text.secondary">
                    {' '}
                    · this month
                  </Typography>
                ) : null}
              </Box>
              {model.groups.map((group) => {
                const part = row.parts.find((entry) => entry.groupId === group.groupId);
                return (
                  <Box component="td" key={group.groupId} sx={number}>
                    {part ? (
                      <MoneyText amount={part.amount} currency={model.currency} tone="neutral" />
                    ) : (
                      <>
                        <span aria-hidden="true">–</span>
                        <Box component="span" sx={visuallyHidden}>
                          None
                        </Box>
                      </>
                    )}
                  </Box>
                );
              })}
              <Box component="td" sx={number}>
                <MoneyText
                  amount={row.amount}
                  currency={model.currency}
                  tone="neutral"
                  sx={{ fontWeight: 600 }}
                />
              </Box>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
