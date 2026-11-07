'use client';
import { type ReactNode } from 'react';
import GlobalStyles from '@mui/material/GlobalStyles';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import MoneyText from '@/components/common/MoneyText';
import { getCurrency } from '@splitbook/shared/currency';
import { displayMajorAmount } from '@splitbook/shared/exact-money';
import { formatCurrencyWithMinus } from '@splitbook/shared/money';
import { getSemanticTokens } from '@/lib/theme/tokens';
import { statementDay, zonedDateTime } from '@splitbook/shared/export-csv';
import { categoryLabel } from '@splitbook/shared/categories';
import ExportPaymentDescription from '@/components/export/ExportPaymentDescription';
import BrandLogo from '@/components/layout/BrandLogo';
import {
  isEmptyStatementCurrency,
  type OutsideTrip,
  type Statement,
} from '@splitbook/shared/statement';
import { SEPARATOR, counted } from '@splitbook/shared/separator';
import { lineMayWrap } from './person-name';
import { statementSummary } from './statement-summary';
import { scrollBox } from '@/components/common/scroll-box';

const light = getSemanticTokens('light');
/** A whole trip's Expenses and Payments outside the Trip's dates. */
const OUTSIDE_TRIP: Record<OutsideTrip, string> = {
  before: 'Before the trip',
  after: 'After the trip',
};
const expenses = (count: number) => counted(count, 'Expense');

/**
 * What a column holds, and so how its cells lay out (#646). Figures and dates never wrap, so
 * "₹54,000.00" and "5 Jun 2026" never break across lines; figures are right-aligned. Only free
 * text (an Expense's description, a payment's note or its cross-currency sentence) wraps; a long
 * name wraps between words and after a hyphen, never inside one (#928). A table wider than the
 * sheet scrolls on screen, never in print.
 */
type ColumnKind = 'text' | 'wrap' | 'sentence' | 'date' | 'money' | 'people';
const COLUMN_SX = {
  text: { whiteSpace: 'normal' },
  wrap: { whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: '10em' },
  sentence: { whiteSpace: 'normal', minWidth: '14em' },
  date: { whiteSpace: 'nowrap' },
  money: { whiteSpace: 'nowrap', textAlign: 'right' },
  people: { whiteSpace: 'nowrap' },
} as const satisfies Record<ColumnKind, object>;
interface Column {
  label: string;
  kind: ColumnKind;
}
const column = (label: string, kind: ColumnKind): Column => ({ label, kind });

/** A day of the statement's period, "14 Sep 2026", on one line (#907). */
function PeriodDay({ day }: { day: string }) {
  return (
    <Box component="span" className="statement-period-day" sx={{ whiteSpace: 'nowrap' }}>
      {statementDay(day)}
    </Box>
  );
}

function Cell({
  kind,
  row = false,
  children,
}: {
  kind: ColumnKind;
  /** The row's header cell. */
  row?: boolean;
  children: ReactNode;
}) {
  return (
    <TableCell
      className={`statement-${kind}`}
      {...(row ? { component: 'th', scope: 'row' } : {})}
      sx={COLUMN_SX[kind]}
    >
      {children}
    </TableCell>
  );
}

/**
 * A name beside its amount in Paid by and Share. An everyday line stays whole, and the amount
 * never wraps. A long line (lineMayWrap: the name with its written amount) may wrap, so it can't
 * push Share past the sheet or the page: the name between its words and after a hyphen, never
 * inside a word, and the amount under it at the column's right edge (#928). A single payer has
 * no amount: it is the Expense's Amount, in the next column (#918).
 */
function PersonAmount({
  name,
  amount,
  children,
}: {
  name: string;
  /** The amount as written beside the name, if any. */
  amount?: string;
  children?: ReactNode;
}) {
  const mayWrap = lineMayWrap(name, amount);
  return (
    <Box
      className="statement-line"
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 1.5,
        whiteSpace: 'nowrap',
        ...(mayWrap
          ? {
              flexWrap: 'wrap',
              rowGap: 0,
              '& > .statement-amount': { marginLeft: 'auto' },
              // Set apart from the person after it, so an amount on its own line never reads as
              // the next name's (#928).
              '& + *': { marginTop: '4px' },
            }
          : {}),
      }}
    >
      <Box
        component="span"
        className="statement-name"
        sx={{ whiteSpace: mayWrap ? 'normal' : 'nowrap' }}
      >
        {name}
      </Box>
      {children}
    </Box>
  );
}

function StatementTable({
  title,
  columns,
  children,
}: {
  title: string;
  columns: Column[];
  children: ReactNode;
}) {
  return (
    <Box
      className="statement-table-region"
      role="region"
      aria-label={title}
      tabIndex={0}
      sx={{
        ...scrollBox,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'focus.main', outlineOffset: 2 },
      }}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map(({ label, kind }) => (
              // As the Export preview heads its tables: on one line, aligned with the column.
              <TableCell
                key={label}
                component="th"
                scope="col"
                className={`statement-${kind}`}
                sx={[COLUMN_SX[kind], { whiteSpace: 'nowrap' }]}
              >
                {label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </Box>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 3 }}>
      <Typography component="h3" variant="h6" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
export default function StatementView({ statement }: { statement: Statement }) {
  return (
    <Box
      className="statement-paper"
      sx={{
        bgcolor: 'background.paper',
        color: 'text.primary',
        // On screen, an A4 sheet: 210 mm wide, at least 297 mm tall, with the print margin.
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '210mm',
        minHeight: { md: '297mm' },
        mx: 'auto',
        p: { xs: 2, sm: 3, md: '15mm' },
        border: 1,
        borderColor: 'divider',
        borderRadius: '4px',
        boxShadow: 2,
        '--statement-print-paper': light.surface,
        '--statement-print-text': light.text,
        '--statement-print-border': light.border,
      }}
    >
      <GlobalStyles
        styles={{
          'body:has(.statement-paper)': {
            '--statement-print-paper': light.surface,
            '--statement-print-text': light.text,
            '--statement-print-border': light.border,
          },
        }}
      />
      <Box className="statement-logo" sx={{ display: 'flex', mb: 2 }}>
        <BrandLogo height={24} />
      </Box>
      <Typography component="h1" variant="h4">
        {statement.name}
        {SEPARATOR}Statement
      </Typography>
      <Typography color="text.secondary">
        {statement.from && statement.to ? (
          <>
            <PeriodDay day={statement.from} /> – <PeriodDay day={statement.to} />
          </>
        ) : (
          'All time'
        )}
        {SEPARATOR}
        {statement.currencies.map((row) => row.currency).join(', ')}
        {SEPARATOR}
        {statement.timeZone}
      </Typography>
      {statement.wholeTrip ? (
        <Typography>Whole trip, including Expenses before and after the Trip’s dates.</Typography>
      ) : null}
      <Box className="statement-controls" sx={{ display: 'flex', gap: 2, my: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </Box>
      {statement.currencies.map((bucket) => (
        <CurrencySection key={bucket.currency} bucket={bucket} statement={statement} />
      ))}
    </Box>
  );
}

/** Never "₹54,000. / 00": MoneyText may break anywhere elsewhere, never on the statement. */
const WHOLE_FIGURE = { whiteSpace: 'nowrap', overflowWrap: 'normal' } as const;

/** Printed even with background graphics off: the Summary strip's dividers are backgrounds. */
const KEEP_BACKGROUND = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as const;

/** The summary as a row of figures, each label above its value, as the Export preview has it. */
function SummaryRow({ bucket }: { bucket: Statement['currencies'][number] }) {
  const currency = bucket.currency;
  return (
    <Box
      component="dl"
      aria-label={`${currency} summary`}
      className="statement-summary"
      // One ruled strip, a rule above and below and a divider between figures, as the board's
      // summary strip; stacked on a phone, the dividers run across. A tile is never narrower than
      // its figure, kept whole (#943): where three don't fit side by side, the strip wraps between
      // tiles. The dividers are the strip's own background, the rule colour, showing through its
      // 1 px gaps, between tiles and between rows; each tile covers it with the sheet's surface.
      // So no rule exists at a row's start at all, and nothing is hidden by clipping, which
      // anti-aliased a hidden rule back in at fractional zoom. Every row is filled edge to edge
      // (tiles grow), and the strip is never narrower than its widest tile, so the background
      // shows only in the gaps. Its top and bottom rules stay borders, with the background
      // clipped inside them. From sm the first tile's basis is 1 px more than the others', so the
      // two dividers fall at W/3 and 2W/3, where the old three-column grid drew them. Print keeps
      // the background (print-color-adjust here; statement.css repaints it for paper). The rule
      // colour stops 1 px short of each side (#949): at fractional zoom, and in the PDF, a tile's
      // outer edge blends with what lies behind it, which is then the sheet's paper and not the
      // rule colour. Every gap lies inside that inset.
      sx={(theme) => ({
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1px',
        m: 0,
        mb: 1.5,
        minWidth: 'min-content',
        backgroundImage: `linear-gradient(${theme.palette.divider}, ${theme.palette.divider})`,
        backgroundSize: 'calc(100% - 2px) 100%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundClip: 'padding-box',
        borderTop: 1,
        borderBottom: 1,
        borderColor: 'divider',
        ...KEEP_BACKGROUND,
      })}
    >
      {statementSummary(bucket).map((figure, index) => (
        <Box
          key={figure.label}
          className="statement-summary-item"
          sx={{
            flex: { xs: '1 1 100%', sm: index === 0 ? '1 1 1px' : '1 1 0' },
            px: 2,
            py: 1.25,
            bgcolor: 'background.paper',
            ...KEEP_BACKGROUND,
          }}
        >
          <Typography
            component="dt"
            className="statement-summary-label"
            sx={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'text.secondary',
            }}
          >
            {figure.label}
          </Typography>
          <Box component="dd" sx={{ m: 0, mt: 0.5 }}>
            {'count' in figure ? (
              <Typography
                component="span"
                sx={(theme) => ({
                  ...theme.typography.money,
                  fontSize: '1.25rem',
                  fontWeight: 600,
                })}
              >
                {figure.count}
              </Typography>
            ) : (
              <MoneyText
                className="statement-summary-figure"
                amount={displayMajorAmount(figure.amountMinor, currency)}
                currency={currency}
                tone="neutral"
                // Whole, as the tables' amounts: never "CHF 20,000,000.0 / 0" (#943).
                sx={{ fontSize: '1.25rem', fontWeight: 600, ...WHOLE_FIGURE }}
              />
            )}
            {'note' in figure ? (
              <Typography
                component="span"
                sx={{ display: 'block', fontSize: '0.75rem', color: 'text.secondary' }}
              >
                {figure.note}
              </Typography>
            ) : null}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function CurrencySection({
  bucket,
  statement,
}: {
  bucket: Statement['currencies'][number];
  statement: Statement;
}) {
  const currency = bucket.currency;
  if (isEmptyStatementCurrency({ ...bucket, paymentCount: bucket.payments.length })) {
    return (
      <Box component="section" aria-label={`${currency} statement`} sx={{ mt: 3 }}>
        <Typography>{currency}: nothing in this period; everyone is settled up.</Typography>
      </Box>
    );
  }
  const name = (id: string) => statement.names[id] ?? 'Former member';
  // A currency Splitbook no longer supports has no position, so no one's figures here (#820).
  const inBalances = !!getCurrency(currency);
  /** An amount as MoneyText writes it, "₹51,333.50". */
  const written = (minor: number) =>
    formatCurrencyWithMinus(displayMajorAmount(minor, currency), currency);
  const amount = (minor: number) => (
    <MoneyText
      className="statement-amount"
      amount={displayMajorAmount(minor, currency)}
      currency={currency}
      tone="neutral"
      sx={WHOLE_FIGURE}
    />
  );
  return (
    <Box component="section" aria-label={`${currency} statement`} sx={{ mt: 3 }}>
      <Typography component="h2" variant="h5">
        {currency}
      </Typography>
      <Typography color="text.secondary">
        Amounts stay in their own currencies; never converted.
      </Typography>
      <Section title="Summary">
        <SummaryRow bucket={bucket} />
        {(['before', 'after'] as const).map((part) => {
          const outside = part === 'before' ? bucket.beforeTrip : bucket.afterTrip;
          return outside ? (
            <Typography key={part} color="text.secondary">
              {OUTSIDE_TRIP[part]}: {amount(outside.spentMinor)}
              {SEPARATOR}
              {expenses(outside.expenseCount)}, counted in Spent
            </Typography>
          ) : null;
        })}
      </Section>
      {inBalances ? null : (
        <Typography sx={{ mt: 2 }}>
          {currency} is a currency Splitbook no longer supports, so this money isn’t in Balances.
        </Typography>
      )}
      {inBalances ? (
        <>
          <Section title="Paid, Share and Net">
            <Typography color="text.secondary">
              Expense contributions for this period. Net is Paid minus Share.
            </Typography>
            <StatementTable
              title="People’s contributions"
              columns={[
                column('Member', 'text'),
                column('Paid', 'money'),
                column('Share', 'money'),
                column('Net', 'money'),
              ]}
            >
              {bucket.people.map((person) => (
                <TableRow key={person.id}>
                  <Cell kind="text" row>
                    {person.name}
                  </Cell>
                  <Cell kind="money">{amount(person.paidMinor)}</Cell>
                  <Cell kind="money">{amount(person.shareMinor)}</Cell>
                  <Cell kind="money">{amount(person.netMinor)}</Cell>
                </TableRow>
              ))}
            </StatementTable>
          </Section>
          <Section title="Balances and suggested payments">
            {/* In print, the balances and their Suggested payments stay on one page, with the
                sentence that opens them, so the heading never prints apart from them (#646). */}
            <Box className="statement-keep-together">
              <Typography color="text.secondary">
                Current all-time positions, including every recorded payment. These match Balances;
                the period changes spending only.
              </Typography>
              <StatementTable
                title="Current balances"
                columns={[column('Member', 'text'), column('Balance', 'money')]}
              >
                {bucket.people.map((person) => (
                  <TableRow key={person.id}>
                    <Cell kind="text" row>
                      {person.name}
                    </Cell>
                    <Cell kind="money">{amount(person.balanceMinor)}</Cell>
                  </TableRow>
                ))}
              </StatementTable>
              {bucket.suggestedPayments.length ? (
                <Box component="ul" aria-label={`${currency} suggested payments`}>
                  {bucket.suggestedPayments.map((row) => (
                    <li key={`${row.from}-${row.to}`}>
                      {name(row.from)} pays {name(row.to)} {amount(row.amountMinor)}
                    </li>
                  ))}
                </Box>
              ) : (
                <Typography>Settled up.</Typography>
              )}
            </Box>
          </Section>
        </>
      ) : null}
      <Section title="Expenses with shares">
        {bucket.expenses.length ? (
          <StatementTable
            title="Expense details"
            columns={[
              column('Date', 'date'),
              column('Description', 'wrap'),
              column('Paid by', 'people'),
              column('Amount', 'money'),
              column('Share', 'people'),
            ]}
          >
            {bucket.expenses.map((row) => (
              <TableRow key={row.id}>
                <Cell kind="date">
                  {/* A calendar day (#437), as the web writes a date (#907). */}
                  <span className="statement-when">{statementDay(row.date)}</span>
                  {row.outsideTrip ? (
                    <Typography variant="caption" component="div">
                      {OUTSIDE_TRIP[row.outsideTrip]}
                    </Typography>
                  ) : null}
                </Cell>
                <Cell kind="wrap" row>
                  {row.description}
                  {/* A long Description may break anywhere; its caption breaks between words,
                      never inside one (#929). */}
                  <Typography
                    variant="caption"
                    component="div"
                    className="statement-caption"
                    sx={{ overflowWrap: 'normal' }}
                  >
                    {categoryLabel(row.category)}
                    {SEPARATOR}
                    {row.tag}
                  </Typography>
                </Cell>
                <Cell kind="people">
                  {row.paidBy.map((person) => (
                    <PersonAmount
                      key={person.userId}
                      name={name(person.userId)}
                      amount={row.paidBy.length > 1 ? written(person.amountMinor) : undefined}
                    >
                      {row.paidBy.length > 1 ? amount(person.amountMinor) : null}
                    </PersonAmount>
                  ))}
                </Cell>
                <Cell kind="money">{amount(row.amountMinor)}</Cell>
                <Cell kind="people">
                  {row.splitBetween.map((person) => (
                    <PersonAmount
                      key={person.userId}
                      name={name(person.userId)}
                      amount={written(person.amountMinor)}
                    >
                      {amount(person.amountMinor)}
                    </PersonAmount>
                  ))}
                </Cell>
              </TableRow>
            ))}
          </StatementTable>
        ) : (
          <Typography>No Expenses in this period.</Typography>
        )}
      </Section>
      <Section title="Payments by date">
        {statement.wholeTrip ? (
          <Typography color="text.secondary">
            Every recorded payment, including those before and after the trip.
          </Typography>
        ) : null}
        {bucket.payments.length ? (
          <StatementTable
            title="Dated payments"
            columns={[
              column('Date and time', 'date'),
              column('From', 'text'),
              column('To', 'text'),
              column('Amount', 'money'),
              column('Note', 'wrap'),
              column('Recorded by', 'text'),
            ]}
          >
            {bucket.payments.map((row) => (
              <TableRow key={row.id}>
                <Cell kind="date">
                  <span className="statement-when">
                    {zonedDateTime(row.at, statement.timeZone)}
                  </span>
                  {row.outsideTrip ? (
                    <Typography variant="caption" component="div">
                      {OUTSIDE_TRIP[row.outsideTrip]}
                    </Typography>
                  ) : null}
                </Cell>
                <Cell kind="text">{name(row.fromId)}</Cell>
                <Cell kind="text">{name(row.toId)}</Cell>
                {/* A cross-currency payment's sentence wraps between its words, like text. */}
                {row.description ? (
                  <Cell kind="sentence">
                    <ExportPaymentDescription
                      description={row.description}
                      currency={row.currency}
                      paidCurrency={row.paidCurrency}
                    />
                  </Cell>
                ) : (
                  <Cell kind="money">{amount(row.amountMinor)}</Cell>
                )}
                <Cell kind="wrap">{row.note}</Cell>
                <Cell kind="text">{name(row.recordedById)}</Cell>
              </TableRow>
            ))}
          </StatementTable>
        ) : (
          <Typography>
            {statement.wholeTrip ? 'No payments recorded.' : 'No payments in this period.'}
          </Typography>
        )}
      </Section>
    </Box>
  );
}
