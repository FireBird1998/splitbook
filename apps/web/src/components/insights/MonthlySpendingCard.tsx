'use client';

import { createContext, useCallback, useContext, useId, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartsTooltipContainer, useAxesTooltip } from '@mui/x-charts/ChartsTooltip';
import { useDrawingArea, useYScale } from '@mui/x-charts/hooks';
import SegmentedControl from '@/components/charts/SegmentedControl';
import {
  HomeCard,
  HomeCardBody,
  HomeCardEmpty,
  HomeCardError,
  HomeCardLoading,
} from '@/components/dashboard/HomeCard';
import { compactMoney, valueAxis } from '@/components/dashboard/spending-chart';
import { visuallyHidden } from './a11y';
import type { MonthlySpending, MonthlyRow } from './group-insights';

/*
 * "Monthly spending" on a Group's Insights tab (#314, design canvas "Web portal", Group
 * insights): the whole Group's Spent per Month as columns in one series colour, the Month the
 * tab is on in the full colour and the earlier Months soft, and the average of the earlier
 * Months as a line in a text colour (never a second hue). The Month is not in its own average.
 * A Chart/Table switch: the table, with its average row, is what assistive technology reads in
 * either view, and the chart is hidden from it.
 */

const CARD_ID = 'monthly-spending';
const PLOT_HEIGHT = 220;
const Y_AXIS_WIDTH = 56;
/** Room right of the plot for the average's label, as on the canvas; a phone uses a key instead. */
const LABEL_MARGIN = 92;
const PLAIN_MARGIN = 8;
/** Below this card width the average is named in a key under the chart. */
const LABEL_MIN_WIDTH = 520;
/** The canvas's thin marks: 24 px columns, never more than 70% of a Month's band. */
const BAR_WIDTH = 24;
const MIN_GAP_RATIO = 0.3;
/** About one character of the 11.5 px mono label: a figure wider than its band is shortened. */
const LABEL_CHARACTER_WIDTH = 7;

export type MonthlyView = 'chart' | 'table';

interface MonthlySpendingCardProps {
  /** Null while there is nothing to show: see `state`. */
  model: MonthlySpending | null;
  state: 'ready' | 'loading' | 'failed' | 'empty';
  onRetry: () => void;
  initialView?: MonthlyView;
}

export default function MonthlySpendingCard({
  model,
  state,
  onRetry,
  initialView = 'chart',
}: MonthlySpendingCardProps) {
  const [view, setView] = useState<MonthlyView>(initialView);
  return (
    <HomeCard
      id={CARD_ID}
      title="Monthly spending"
      subtitle={model && state === 'ready' ? model.subtitle : undefined}
      aside={
        model && state === 'ready' ? (
          <SegmentedControl
            label="Show monthly spending as"
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
      {model && state === 'ready' ? (
        <HomeCardBody>
          {view === 'chart' ? (
            <>
              <MonthlyColumns model={model} />
              <MonthlyTable model={model} hidden />
            </>
          ) : (
            <MonthlyTable model={model} />
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.75 }}>
            {model.explanation}
          </Typography>
        </HomeCardBody>
      ) : state === 'empty' ? (
        <HomeCardEmpty
          title="No Expenses yet"
          description="Each month’s spending shows here, with the average of the months before it."
        />
      ) : state === 'failed' ? (
        <HomeCardError message="Monthly spending could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading monthly spending" blocks={1} height={PLOT_HEIGHT} />
      )}
    </HomeCard>
  );
}

/** The rows a tooltip describes. A context, so the tooltip's portal still sees them. */
const ModelContext = createContext<MonthlySpending | null>(null);

function MonthTooltip() {
  const axes = useAxesTooltip();
  const model = useContext(ModelContext);
  const row = axes?.[0] && model ? model.rows[axes[0].dataIndex] : undefined;
  return (
    <ChartsTooltipContainer trigger="axis">
      {row && model ? (
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
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <Box component="span" sx={(theme) => ({ ...theme.typography.money, fontWeight: 600 })}>
            {row.spentText}
          </Box>
          <span>{row.long}</span>
          <span>
            {row.expenseCount} {row.expenseCount === 1 ? 'Expense' : 'Expenses'} · your share{' '}
            <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
              {row.shareText}
            </Box>
          </span>
          {row.focus && model.focusComparison ? <span>{model.focusComparison}</span> : null}
        </Box>
      ) : null}
    </ChartsTooltipContainer>
  );
}

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
function gapRatio(band: number | null): number {
  if (band === null) return 0.7;
  return band > 0 ? Math.max(MIN_GAP_RATIO, 1 - BAR_WIDTH / band) : MIN_GAP_RATIO;
}

/**
 * The average as a line across the plot, in the secondary text colour, with its name and
 * figure to the right of the plot when there is room for them (the canvas's .ins-ref).
 */
function AverageLine({
  value,
  name,
  text,
  labelled,
}: {
  value: number;
  name: string;
  text: string;
  labelled: boolean;
}) {
  const { palette, typography } = useTheme();
  const { left, width } = useDrawingArea();
  const scale = useYScale() as (input: number) => number | undefined;
  const y = scale(value);
  if (y === undefined || !Number.isFinite(y)) return null;
  return (
    <g data-testid="monthly-average-line">
      <path
        d={`M ${left} ${y} l ${width} 0`}
        stroke={palette.text.secondary}
        strokeWidth={1.5}
        shapeRendering="crispEdges"
        fill="none"
      />
      {labelled ? (
        <text
          x={left + width + 10}
          y={y}
          fill={palette.text.secondary}
          fontSize={12}
          fontFamily={typography.fontFamily}
        >
          <tspan x={left + width + 10} dy="-0.2em">
            {name}
          </tspan>
          <tspan
            x={left + width + 10}
            dy="1.25em"
            fontFamily={(typography.money as { fontFamily?: string }).fontFamily}
          >
            {text}
          </tspan>
        </text>
      ) : null}
    </g>
  );
}

function MonthlyColumns({ model }: { model: MonthlySpending }) {
  const { palette, typography } = useTheme();
  const [measure, width] = useWidth();
  const average = model.average;
  const labelled = Boolean(average) && width !== null && width >= LABEL_MIN_WIDTH;
  const rightMargin = labelled ? LABEL_MARGIN : PLAIN_MARGIN;
  const band = width ? Math.max(0, (width - Y_AXIS_WIDTH - rightMargin) / model.rows.length) : null;
  const axis = valueAxis(Math.max(average?.spent ?? 0, ...model.rows.map((row) => row.spent)));
  const focus = model.rows[model.rows.length - 1];
  // The Month's figure above its column: exact when it fits, as on a phone it may not.
  const focusLabel =
    band === null || band >= focus.spentText.length * LABEL_CHARACTER_WIDTH
      ? focus.spentText
      : compactMoney(focus.spent, model.currency);
  const months = model.rows.map((row) => row.month);
  const last = model.rows.length - 1;
  const short = useMemo(
    () => new Map(model.rows.map((row: MonthlyRow) => [row.month, row.short])),
    [model.rows],
  );

  return (
    <ModelContext.Provider value={model}>
      <Box ref={measure} aria-hidden="true" data-testid="monthly-columns">
        <BarChart
          height={PLOT_HEIGHT}
          hideLegend
          skipAnimation
          borderRadius={4}
          grid={{ horizontal: true }}
          axisHighlight={{ x: 'none' }}
          margin={{ top: 24, right: rightMargin, bottom: 0, left: 0 }}
          series={[
            {
              id: 'spent',
              label: 'Spent',
              data: model.rows.map((row) => row.spent),
              barLabel: (item) => (item.dataIndex === last ? focusLabel : null),
              barLabelPlacement: 'outside',
            },
          ]}
          xAxis={[
            {
              scaleType: 'band',
              data: months,
              valueFormatter: (month: string) => short.get(month) ?? month,
              categoryGapRatio: gapRatio(band),
              disableTicks: true,
              colorMap: {
                type: 'ordinal',
                values: months,
                colors: model.rows.map((row) =>
                  row.focus ? palette.chart.series : palette.chart.seriesSoft,
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
          slots={{ tooltip: MonthTooltip }}
          sx={{
            '& .MuiChartsAxis-tickLabel': { fontSize: '0.75rem' },
            '& .MuiChartsAxis-directionY .MuiChartsAxis-tickLabel': { fontSize: '0.71875rem' },
            '& .MuiBarLabel-root': {
              ...(typography.money as object),
              fill: palette.text.secondary,
              fontSize: '0.71875rem',
            },
          }}
        >
          {average ? (
            <AverageLine
              value={average.spent}
              name={average.shortName}
              text={average.spentText}
              labelled={labelled}
            />
          ) : null}
        </BarChart>
        {average && !labelled ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mt: 1,
              fontSize: '0.78125rem',
              color: 'text.secondary',
            }}
          >
            <Box
              component="span"
              sx={{ width: 16, height: 0, borderTop: 2, borderColor: 'text.secondary' }}
            />
            <span>{average.name}</span>
            <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
              {average.spentText}
            </Box>
          </Box>
        ) : null}
      </Box>
    </ModelContext.Provider>
  );
}

/**
 * The same numbers as the chart: a row per Month with its Spent and the member's share, then
 * the average of the earlier Months. Hidden, it is what assistive technology reads in the
 * Chart view. Shown, it scrolls sideways inside the card when it must, and takes focus so the
 * keyboard can scroll it.
 */
function MonthlyTable({ model, hidden = false }: { model: MonthlySpending; hidden?: boolean }) {
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
        sx: { position: 'relative', overflowX: 'auto', borderRadius: 1 },
        tabIndex: 0,
        role: 'group',
        'aria-labelledby': captionId,
      };
  const money = (theme: { typography: { money: object } }) => ({ ...theme.typography.money });
  // The Month's row stands out, as its column does in the chart.
  const figure = (focus: boolean) => ({ color: 'text.primary', fontWeight: focus ? 600 : 500 });
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
          // The average row draws its own rule above it; without one, the last Month has none.
          '& tbody tr:last-of-type > *': { borderBottom: 0 },
          '& tfoot > tr > *': { borderTop: 1, borderBottom: 0, borderColor: 'border.strong' },
        }}
      >
        <Box component="caption" id={captionId} sx={visuallyHidden}>
          The whole Group’s spending in {model.currency}, by month, with your share
          {model.average ? ` and the ${model.average.rowLabel.toLowerCase()}` : ''}
        </Box>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={cell}>
              Month
            </Box>
            <Box component="th" scope="col" sx={number}>
              Spent
            </Box>
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
                  fontWeight: row.focus ? 600 : 400,
                  color: 'text.primary',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.long}
              </Box>
              <Box component="td" sx={[number, money, figure(row.focus)]}>
                {row.spentText}
              </Box>
              <Box component="td" sx={[number, money, figure(row.focus)]}>
                {row.shareText}
              </Box>
            </tr>
          ))}
        </tbody>
        {model.average ? (
          <tfoot>
            <tr>
              <Box
                component="th"
                scope="row"
                sx={{ ...cell, fontWeight: 400, color: 'text.secondary', whiteSpace: 'nowrap' }}
              >
                {model.average.rowLabel}
              </Box>
              <Box component="td" sx={[number, money, { color: 'text.primary' }]}>
                {model.average.spentText}
              </Box>
              <Box component="td" sx={[number, money, { color: 'text.primary' }]}>
                {model.average.shareText}
              </Box>
            </tr>
          </tfoot>
        ) : null}
      </Box>
    </Box>
  );
}
