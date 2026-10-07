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
import { visuallyHidden } from '@/components/insights/a11y';
import type { TripCardState, TripDayChart, TripDayRow } from './trip-summary';

/*
 * "Day by day" on a Trip's Insights tab (#316, design canvas "Web portal", Trip Group): each of
 * the Trip's days as a column in one series colour (the biggest day in the full colour, the
 * others soft), and the daily average as a line in a text colour, never a second hue. The
 * tooltip names the day's two biggest Expenses and the member's share. A Chart/Table switch:
 * the table, with the days outside the Trip and the whole trip, is what assistive technology
 * reads in either view, and the chart is hidden from it.
 */

const CARD_ID = 'trip-days';
const PLOT_HEIGHT = 220;
const Y_AXIS_WIDTH = 56;
/** Room right of the plot for the average's label; a narrow card names it in a key instead. */
const LABEL_MARGIN = 104;
const PLAIN_MARGIN = 8;
const LABEL_MIN_WIDTH = 520;
/** Thin marks, as on the canvas: at most 28 px, never more than 70% of a day's band. */
const BAR_WIDTH = 28;
const MIN_GAP_RATIO = 0.3;
const LABEL_CHARACTER_WIDTH = 7;

export type TripDayView = 'chart' | 'table';

interface TripDayChartCardProps {
  /** Null while there is nothing to show: see `state`. */
  model: TripDayChart | null;
  state: TripCardState;
  onRetry: () => void;
  initialView?: TripDayView;
}

export default function TripDayChartCard({
  model,
  state,
  onRetry,
  initialView = 'chart',
}: TripDayChartCardProps) {
  const [view, setView] = useState<TripDayView>(initialView);
  const ready = model && state === 'ready';
  const drawable = ready && model.rows.length > 0;
  return (
    <HomeCard
      id={CARD_ID}
      title="Day by day"
      subtitle={ready ? model.subtitle : undefined}
      aside={
        drawable ? (
          <SegmentedControl
            label="Show day by day as"
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
      {ready ? (
        <HomeCardBody>
          {drawable ? (
            view === 'chart' ? (
              <>
                <DayColumns model={model} />
                <DayTable model={model} hidden />
              </>
            ) : (
              <DayTable model={model} />
            )
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ mt: drawable ? 1.75 : 0 }}>
            {model.explanation}
          </Typography>
          {model.outsideNote ? (
            <Typography
              component="p"
              sx={{ mt: 0.5, fontSize: '0.75rem', lineHeight: 1.4, color: 'text.secondary' }}
            >
              {model.outsideNote}
            </Typography>
          ) : null}
        </HomeCardBody>
      ) : state === 'empty' ? (
        <HomeCardEmpty
          title="No Expenses yet"
          description="Each day of the trip shows here, with the daily average, once it has Expenses."
        />
      ) : state === 'failed' ? (
        <HomeCardError message="Day by day could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading day by day" blocks={1} height={PLOT_HEIGHT} />
      )}
    </HomeCard>
  );
}

/** The rows a tooltip describes. A context, so the tooltip's portal still sees them. */
const ModelContext = createContext<TripDayChart | null>(null);

const moneySx = (theme: { typography: { money: object } }) => ({ ...theme.typography.money });

function DayTooltip() {
  const axes = useAxesTooltip();
  const model = useContext(ModelContext);
  const row = axes?.[0] && model ? model.rows[axes[0].dataIndex] : undefined;
  return (
    <ChartsTooltipContainer trigger="axis">
      {row ? (
        <Box
          data-testid="trip-day-tooltip"
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
            maxWidth: 280,
          }}
        >
          <Box component="span" sx={{ fontWeight: 600 }}>
            {row.name}
          </Box>
          <span>
            <Box component="span" sx={moneySx}>
              {row.spentText}
            </Box>{' '}
            spent
          </span>
          {row.biggest.map((expense, index) => (
            <span key={index}>
              {expense.description}{' '}
              <Box component="span" sx={moneySx}>
                {expense.amountText}
              </Box>
            </span>
          ))}
          <span>
            Your share{' '}
            <Box component="span" sx={moneySx}>
              {row.shareText}
            </Box>
          </span>
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

/** The gap between columns, as a share of each day's band, that keeps columns thin. */
function gapRatio(band: number | null): number {
  if (band === null) return 0.6;
  return band > 0 ? Math.max(MIN_GAP_RATIO, 1 - BAR_WIDTH / band) : MIN_GAP_RATIO;
}

/** The daily average as a line across the plot, named to its right when there is room. */
function AverageLine({
  value,
  text,
  labelled,
}: {
  value: number;
  text: string;
  labelled: boolean;
}) {
  const { palette, typography } = useTheme();
  const { left, width } = useDrawingArea();
  const scale = useYScale() as (input: number) => number | undefined;
  const y = scale(value);
  if (y === undefined || !Number.isFinite(y)) return null;
  return (
    <g data-testid="trip-daily-average-line">
      <path
        d={`M ${left} ${y} l ${width} 0`}
        stroke={palette.text.secondary}
        strokeWidth={1.5}
        strokeDasharray="4 3"
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
            Daily average
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

function DayColumns({ model }: { model: TripDayChart }) {
  const { palette, typography } = useTheme();
  const [measure, width] = useWidth();
  const average = model.average;
  const labelled = Boolean(average) && width !== null && width >= LABEL_MIN_WIDTH;
  const rightMargin = labelled ? LABEL_MARGIN : PLAIN_MARGIN;
  const band = width ? Math.max(0, (width - Y_AXIS_WIDTH - rightMargin) / model.rows.length) : null;
  const axis = valueAxis(Math.max(average?.spent ?? 0, ...model.rows.map((row) => row.spent)));
  const focusIndex = model.rows.findIndex((row) => row.focus);
  const focus = focusIndex >= 0 ? model.rows[focusIndex] : null;
  // The biggest day's figure above its column: exact when it fits, as on a phone it may not.
  const focusLabel = !focus
    ? null
    : band === null || band >= focus.spentText.length * LABEL_CHARACTER_WIDTH
      ? focus.spentText
      : compactMoney(focus.spent, model.currency);
  const days = model.rows.map((row) => row.day);
  const axisLabel = useMemo(
    () => new Map(model.rows.map((row: TripDayRow) => [row.day, row.axis])),
    [model.rows],
  );

  return (
    <ModelContext.Provider value={model}>
      <Box ref={measure} aria-hidden="true" data-testid="trip-day-columns">
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
              barLabel: (item) => (item.dataIndex === focusIndex ? focusLabel : null),
              barLabelPlacement: 'outside',
            },
          ]}
          xAxis={[
            {
              scaleType: 'band',
              data: days,
              valueFormatter: (day: string) => axisLabel.get(day) ?? day,
              categoryGapRatio: gapRatio(band),
              disableTicks: true,
              colorMap: {
                type: 'ordinal',
                values: days,
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
          slots={{ tooltip: DayTooltip }}
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
            <AverageLine value={average.spent} text={average.text} labelled={labelled} />
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
              sx={{
                width: 16,
                height: 0,
                borderTop: 2,
                borderStyle: 'dashed',
                borderColor: 'text.secondary',
              }}
            />
            <span>Daily average</span>
            <Box component="span" sx={moneySx}>
              {average.text}
            </Box>
          </Box>
        ) : null}
      </Box>
    </ModelContext.Provider>
  );
}

/**
 * The same numbers as the chart: a row per day with its Expenses, Spent and the member's share,
 * then the days outside the Trip, the daily average and the whole trip. Hidden, it is what
 * assistive technology reads in the Chart view. Shown, it scrolls sideways inside the card when
 * it must, and takes focus so the keyboard can scroll it.
 */
function DayTable({ model, hidden = false }: { model: TripDayChart; hidden?: boolean }) {
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
        role: 'region',
        'aria-label': 'Day by day, as a table',
        tabIndex: 0,
        sx: {
          position: 'relative',
          overflowX: 'auto',
          borderRadius: 1,
          '&:focus-visible': { outline: 2, outlineColor: 'focus.main', outlineOffset: -2 },
        },
      };
  const figure = (focus: boolean) => ({ color: 'text.primary', fontWeight: focus ? 600 : 500 });
  const rowHeader = (weight: number, color = 'text.primary') => ({
    ...cell,
    fontWeight: weight,
    color,
    whiteSpace: 'nowrap',
  });
  return (
    <Box {...frame}>
      <Box
        component="table"
        sx={{
          width: '100%',
          minWidth: 460,
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          '& thead th': {
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
          },
          '& tbody tr:last-of-type > *': { borderBottom: 0 },
          '& tfoot > tr:first-of-type > *': { borderTop: 1, borderColor: 'border.strong' },
          '& tfoot > tr:last-of-type > *': { borderBottom: 0 },
        }}
      >
        <Box component="caption" id={captionId} sx={visuallyHidden}>
          {`The trip’s spending in ${model.currency}, day by day, with your share`}
        </Box>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={cell}>
              Day
            </Box>
            <Box component="th" scope="col" sx={number}>
              Expenses
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
            <tr key={row.day}>
              <Box component="th" scope="row" sx={rowHeader(row.focus ? 600 : 400)}>
                {row.name}
              </Box>
              <Box component="td" sx={number}>
                {row.expenseCount}
              </Box>
              <Box component="td" sx={[number, moneySx, figure(row.focus)]}>
                {row.spentText}
              </Box>
              <Box component="td" sx={[number, moneySx, figure(row.focus)]}>
                {row.shareText}
              </Box>
            </tr>
          ))}
          {model.outside.map((row) => (
            <tr key={row.name}>
              <Box component="th" scope="row" sx={rowHeader(400, 'text.secondary')}>
                {row.name}
                <Box component="span" sx={{ display: 'block', fontSize: '0.75rem' }}>
                  {row.span}
                </Box>
              </Box>
              <Box component="td" sx={number}>
                {row.expenseCount}
              </Box>
              <Box component="td" sx={[number, moneySx, figure(false)]}>
                {row.spentText}
              </Box>
              <Box component="td" sx={[number, moneySx, figure(false)]}>
                {row.shareText}
              </Box>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {model.average ? (
            <tr>
              <Box component="th" scope="row" sx={rowHeader(400, 'text.secondary')}>
                Daily average
              </Box>
              <Box component="td" sx={{ ...number, color: 'text.secondary' }}>
                –
              </Box>
              <Box component="td" sx={[number, moneySx, { color: 'text.primary' }]}>
                {model.average.text}
              </Box>
              <Box component="td" sx={{ ...number, color: 'text.secondary' }}>
                –
              </Box>
            </tr>
          ) : null}
          <tr>
            <Box component="th" scope="row" sx={rowHeader(600)}>
              Whole trip
            </Box>
            <Box component="td" sx={{ ...number, fontWeight: 600 }}>
              {model.whole.expenseCount}
            </Box>
            <Box component="td" sx={[number, moneySx, figure(true)]}>
              {model.whole.spentText}
            </Box>
            <Box component="td" sx={[number, moneySx, figure(true)]}>
              {model.whole.shareText}
            </Box>
          </tr>
        </tfoot>
      </Box>
    </Box>
  );
}
