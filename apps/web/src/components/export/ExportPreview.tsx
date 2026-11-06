'use client';

import { isEmptyStatementCurrency } from '@splitbook/shared/statement';
import ExportPaymentDescription from './ExportPaymentDescription';
import { useState, type ReactNode } from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import MoneyText from '@/components/common/MoneyText';
import { getCurrency } from '@splitbook/shared/currency';
import { displayMajorAmount } from '@splitbook/shared/exact-money';
import { formatCurrencyWithMinus } from '@splitbook/shared/money';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import ErrorState from '@/components/common/ErrorState';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import type { ExportPreview } from '@splitbook/shared/export-preview';
import { exportWindowSlug } from '@splitbook/shared/export-request';
import { FONT_MONO, RADIUS } from '@/lib/theme/tokens';
import { SEPARATOR } from '@splitbook/shared/separator';
import { categoryLabel } from '@splitbook/shared/categories';
import { statementDay, zonedDateTime } from '@splitbook/shared/export-csv';
import { lineMayWrap } from '@/components/statement/person-name';

export type PreviewState =
  | { status: 'idle'; message: string }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ExportPreview };

export function previewPeriod(data: Pick<ExportPreview, 'from' | 'to'>) {
  if (!data.from || !data.to) return 'All time';
  const slug = exportWindowSlug({ from: data.from, to: data.to });
  return /^\d{4}-\d{2}$/.test(slug)
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${slug}-15T12:00:00Z`),
      )
    : `${statementDay(data.from)} – ${statementDay(data.to)}`;
}
/** A money column of a statement preview table: its figures right-aligned, on one line. */
const MONEY = 'export-statement-money';
/** A statement preview cell under its first line: the Expense's "Category · Tag" (#918). */
const CAPTION = 'export-statement-caption';
/** A person's name in a statement preview's Paid by or Share, which wraps if long (#928). */
const PERSON_NAME = 'statement-preview-name';

/**
 * A statement preview's tables fit the Export card (#916), as the statement's compact tables fit
 * its page (statement.css, #910): the statement's small type and padding, the table as wide as
 * the card, and its text columns wrapping so every figure stays in view. Money stays on one line,
 * right-aligned, with room before the column after it (#907).
 */
const COMPACT_SX = {
  width: '100%',
  '& td, & th': {
    fontSize: '0.75rem',
    lineHeight: 1.4,
    p: '4px 6px',
    verticalAlign: 'top',
  },
  '& td *, & th *': { fontSize: 'inherit' },
  '& td:first-child, & th:first-child': { pl: 0 },
  '& td:last-child, & th:last-child': { pr: 0 },
  '& thead th': { whiteSpace: 'nowrap' },
  [`& .${MONEY}`]: { textAlign: 'right', whiteSpace: 'nowrap' },
  [`& .${MONEY} + :not(.${MONEY})`]: { pl: '14px' },
  [`& .${CAPTION}`]: { display: 'block', fontSize: '0.6875rem', color: 'text.secondary' },
} as const;

function PreviewTable({
  label,
  headers,
  money,
  children,
}: {
  label: string;
  headers: string[];
  /** A statement preview table's money columns, by header: the table is compact (#916). */
  money?: string[];
  children: ReactNode;
}) {
  return (
    <Box
      role="region"
      aria-label={label}
      tabIndex={0}
      sx={{
        overflowX: 'auto',
        maxWidth: '100%',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'focus.main', outlineOffset: 2 },
      }}
    >
      <Table
        size="small"
        aria-label={label}
        sx={
          money ? COMPACT_SX : { minWidth: 'max-content', '& td, & th': { whiteSpace: 'nowrap' } }
        }
      >
        <TableHead>
          <TableRow>
            {headers.map((header, i) => (
              <TableCell
                key={i}
                component="th"
                scope="col"
                className={money?.includes(header) ? MONEY : undefined}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </Box>
  );
}

/**
 * A name and its amount in Paid by or Share, as the statement writes them: on one line where
 * the card has room, the amount under the name where it hasn't, never cut off (#916). A wrapped
 * amount keeps to the column's right edge with the other figures, and each person is set a
 * little apart, so an amount never reads as the next person's. A single payer has no amount: it
 * is the Expense's Amount, in the next column (#918), and their name keeps to the left. In a long
 * line (lineMayWrap: the name with its written amount) the name wraps between its words and
 * after a hyphen, never inside a word, so it can't push the columns after it out of the card; an
 * everyday name stays whole, and an amount never wraps (#928).
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
  return (
    <Box
      className="statement-preview-person"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        columnGap: 1.5,
        [`& > :not(.${PERSON_NAME})`]: { whiteSpace: 'nowrap' },
        '& > *:last-child': { marginLeft: 'auto' },
        // A single payer's name stands alone (#918): it keeps to the left, as on the statement.
        '& > *:only-child': { marginLeft: 0 },
        '& + &': { marginTop: '4px' },
      }}
    >
      <Box
        component="span"
        className={PERSON_NAME}
        sx={{ whiteSpace: lineMayWrap(name, amount) ? 'normal' : 'nowrap' }}
      >
        {name}
      </Box>
      {children}
    </Box>
  );
}

const formats = { csv: 'CSV', json: 'Full backup', statement: 'Statement' } as const;
export default function ExportPreviewPanel({
  state,
  onRetry,
}: {
  state: PreviewState;
  onRetry: () => void;
}) {
  const [csvView, setCsvView] = useState<'table' | 'text'>('table');
  const data = state.status === 'ready' ? state.data : null;
  return (
    <Box
      component="section"
      aria-labelledby="export-preview-heading"
      aria-busy={state.status === 'loading' || undefined}
      sx={{
        minWidth: 0,
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
        bgcolor: 'background.paper',
        p: 2.5,
      }}
    >
      <Typography id="export-preview-heading" component="h2" variant="h6">
        Preview
      </Typography>
      {
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          title={
            data
              ? `${data.groupNames.join(', ')}${SEPARATOR}${previewPeriod(data)}${SEPARATOR}${formats[data.format]}`
              : undefined
          }
          sx={{ mb: 2 }}
        >
          {data
            ? `${data.groupNames.join(', ')}${SEPARATOR}${previewPeriod(data)}${SEPARATOR}${formats[data.format]}`
            : '\u00a0'}
        </Typography>
      }
      {state.status === 'idle' && <Typography color="text.secondary">{state.message}</Typography>}
      {state.status === 'loading' && (
        <Box role="status">
          <LinearProgress aria-label="Loading export preview" sx={{ my: 2 }} />
          <Typography color="text.secondary">Loading preview…</Typography>
        </Box>
      )}
      {state.status === 'error' && (
        <ErrorState message={state.message} onRetry={onRetry} retryLabel="Retry" />
      )}
      {data?.format === 'statement' && (
        <Box
          component="article"
          sx={{
            mt: 2,
            p: { xs: 1.5, sm: 2.5 },
            border: 1,
            borderColor: 'divider',
            borderRadius: `${RADIUS.md}px`,
          }}
        >
          <Typography component="h3" variant="h6">
            {data.statement.name}
            {SEPARATOR}Statement{SEPARATOR}
            {previewPeriod(data)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {getGroupTheme(data.statement.theme).label}
            {SEPARATOR}
            {data.statement.defaultCurrency}
            {SEPARATOR}
            Generated {zonedDateTime(data.generatedAt, data.timeZone)} ({data.timeZone})
          </Typography>
          {data.statement.currencies.map((bucket) => {
            if (isEmptyStatementCurrency(bucket)) {
              return (
                <Box
                  component="section"
                  aria-label={`${bucket.currency} statement preview`}
                  key={bucket.currency}
                  sx={{ mt: 2 }}
                >
                  <Typography>
                    {bucket.currency}: nothing in this period; everyone is settled up.
                  </Typography>
                </Box>
              );
            }
            const name = (id: string) => data.statement.names[id] ?? 'Former member';
            // A currency Splitbook no longer supports has no position, so no one's figures (#820).
            const inBalances = !!getCurrency(bucket.currency);
            return (
              <Box
                component="section"
                aria-label={`${bucket.currency} statement preview`}
                key={bucket.currency}
                sx={{ mt: 2 }}
              >
                <Typography component="h4" variant="subtitle1">
                  {bucket.currency}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mb: 2 }}>
                  <Box>
                    <Typography variant="body2">Spent</Typography>
                    <MoneyText
                      amount={displayMajorAmount(bucket.spentMinor, bucket.currency)}
                      currency={bucket.currency}
                      tone="neutral"
                    />
                  </Box>
                  <Box>
                    <Typography variant="body2">Expenses</Typography>
                    <Typography>{bucket.expenseCount}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="body2">Payments</Typography>
                    <Typography component="span">
                      {bucket.paymentCount}
                      {SEPARATOR}
                    </Typography>
                    <MoneyText
                      amount={displayMajorAmount(bucket.paymentTotalMinor, bucket.currency)}
                      currency={bucket.currency}
                      tone="neutral"
                    />
                  </Box>
                </Box>
                {inBalances ? null : (
                  <Typography>
                    {bucket.currency} is a currency Splitbook no longer supports, so this money
                    isn’t in Balances.
                  </Typography>
                )}
                {inBalances ? (
                  <>
                    <PreviewTable
                      label={`${bucket.currency} period contributions`}
                      headers={['Member', 'Paid', 'Share', 'Net']}
                      money={['Paid', 'Share', 'Net']}
                    >
                      {bucket.people.map((person) => (
                        <TableRow key={person.id}>
                          <TableCell component="th" scope="row">
                            {person.name}
                          </TableCell>
                          {[person.paidMinor, person.shareMinor, person.netMinor].map(
                            (minor, i) => (
                              <TableCell key={i} className={MONEY}>
                                <MoneyText
                                  amount={displayMajorAmount(minor, bucket.currency)}
                                  currency={bucket.currency}
                                  tone="neutral"
                                />
                              </TableCell>
                            ),
                          )}
                        </TableRow>
                      ))}
                    </PreviewTable>
                    <Box sx={{ mt: 2 }}>
                      <Typography component="h5" variant="subtitle1">
                        Current balances ({bucket.currency})
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Current all-time positions, including every recorded payment. These match
                        Balances; the period changes spending only.
                      </Typography>
                      <PreviewTable
                        label={`${bucket.currency} current balances`}
                        headers={['Member', 'Balance']}
                        money={['Balance']}
                      >
                        {bucket.people.map((person) => (
                          <TableRow key={person.id}>
                            <TableCell component="th" scope="row">
                              {person.name}
                            </TableCell>
                            <TableCell className={MONEY}>
                              <MoneyText
                                amount={displayMajorAmount(person.balanceMinor, bucket.currency)}
                                currency={bucket.currency}
                                tone="neutral"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </PreviewTable>
                      <Typography component="h5" variant="subtitle1" sx={{ mt: 2 }}>
                        Suggested payments ({bucket.currency})
                      </Typography>
                      {bucket.suggestedPayments.length ? (
                        <Box component="ul" aria-label={`${bucket.currency} suggested payments`}>
                          {bucket.suggestedPayments.map((payment) => (
                            <li key={`${payment.from}-${payment.to}`}>
                              {name(payment.from)} pays {name(payment.to)}{' '}
                              <MoneyText
                                amount={displayMajorAmount(payment.amountMinor, bucket.currency)}
                                currency={bucket.currency}
                                tone="neutral"
                              />
                            </li>
                          ))}
                        </Box>
                      ) : (
                        <Typography>Settled up.</Typography>
                      )}
                    </Box>
                  </>
                ) : null}
                {!!bucket.payments?.length && (
                  <Box sx={{ mt: 2 }}>
                    <Typography component="h5" variant="subtitle1">
                      Payments ({bucket.currency})
                    </Typography>
                    <Box
                      component="ul"
                      aria-label={`${bucket.currency} first payments`}
                      sx={{ p: 0, m: 0, listStyle: 'none' }}
                    >
                      {bucket.payments.map((payment) => (
                        <Box
                          component="li"
                          key={payment.id}
                          sx={{
                            py: 1.5,
                            borderBottom: 1,
                            borderColor: 'divider',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {zonedDateTime(payment.at, data.timeZone)}
                          </Typography>
                          <Box sx={{ my: 0.5 }}>
                            {payment.description ? (
                              <ExportPaymentDescription
                                description={payment.description}
                                currency={payment.currency}
                                paidCurrency={payment.paidCurrency}
                              />
                            ) : (
                              <>
                                {name(payment.fromId)} paid {name(payment.toId)}{' '}
                                <MoneyText
                                  amount={displayMajorAmount(payment.amountMinor, bucket.currency)}
                                  currency={bucket.currency}
                                  tone="neutral"
                                />
                              </>
                            )}
                          </Box>
                          {payment.note && <Typography variant="body2">{payment.note}</Typography>}
                          <Typography variant="caption" color="text.secondary">
                            Recorded by {name(payment.recordedById)}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                    {bucket.paymentCount > bucket.payments.length && (
                      <Typography color="text.secondary">
                        …and {bucket.paymentCount - bucket.payments.length} more payments
                      </Typography>
                    )}
                  </Box>
                )}
                {bucket.expenses.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <PreviewTable
                      label={`${bucket.currency} first Expenses`}
                      headers={['Date', 'Description', 'Paid by', 'Amount', 'Share']}
                      money={['Amount']}
                    >
                      {bucket.expenses.map((expense) => {
                        const people = (allocations: typeof expense.paidBy, amounts = true) => (
                          <TableCell>
                            {allocations.map((person) => (
                              <PersonAmount
                                key={person.userId}
                                name={name(person.userId)}
                                amount={
                                  amounts
                                    ? formatCurrencyWithMinus(
                                        displayMajorAmount(person.amountMinor, bucket.currency),
                                        bucket.currency,
                                      )
                                    : undefined
                                }
                              >
                                {amounts ? (
                                  <MoneyText
                                    amount={displayMajorAmount(person.amountMinor, bucket.currency)}
                                    currency={bucket.currency}
                                    tone="neutral"
                                  />
                                ) : null}
                              </PersonAmount>
                            ))}
                          </TableCell>
                        );
                        return (
                          <TableRow key={expense.id}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {statementDay(expense.date)}
                            </TableCell>
                            {/* As the statement heads a row with its Description, and writes
                                "Category · Tag" under it (#918). */}
                            <TableCell
                              component="th"
                              scope="row"
                              sx={{ minWidth: '6em', overflowWrap: 'anywhere' }}
                            >
                              {expense.description}
                              {/* A long Description may break anywhere; its caption breaks
                                  between words, never inside one (#929). */}
                              <Box
                                component="span"
                                className={CAPTION}
                                sx={{ overflowWrap: 'normal' }}
                              >
                                {categoryLabel(expense.category)}
                                {SEPARATOR}
                                {expense.tag}
                              </Box>
                            </TableCell>
                            {/* One payer paid the Amount: their name alone (#918). */}
                            {people(expense.paidBy, expense.paidBy.length > 1)}
                            <TableCell className={MONEY}>
                              <MoneyText
                                amount={displayMajorAmount(expense.amountMinor, bucket.currency)}
                                currency={bucket.currency}
                                tone="neutral"
                              />
                            </TableCell>
                            {people(expense.splitBetween)}
                          </TableRow>
                        );
                      })}
                    </PreviewTable>
                  </Box>
                )}
                {bucket.expenseCount > bucket.expenses.length && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    …and {bucket.expenseCount - bucket.expenses.length} more Expenses
                  </Typography>
                )}
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 2 }}
                >
                  Amounts in {bucket.currency}, never converted
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
      {data?.empty && (
        <Typography color="text.secondary">
          {data.from || data.to ? 'Nothing to export for this period.' : 'Nothing to export yet.'}
        </Typography>
      )}
      {data?.format === 'json' && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontFamily: FONT_MONO, overflowWrap: 'anywhere' }}>
            {data.fileName}
          </Typography>
          <Typography color="text.secondary">
            Approximately{' '}
            {(data.sizeBytes / (data.sizeBytes >= 1_000_000 ? 1_000_000 : 1_000)).toLocaleString(
              'en-US',
              { maximumFractionDigits: 1 },
            )}{' '}
            {data.sizeBytes >= 1_000_000 ? 'MB' : 'KB'}
          </Typography>
          <BackupCounts
            tiles={[
              { count: data.counts.members, one: 'Member', many: 'Members' },
              {
                count: data.counts.expenses,
                one: 'Expense',
                many: 'Expenses',
                detail: sentence([
                  data.earliestMonth
                    ? `since ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.earliestMonth}-15T12:00:00Z`))}`
                    : null,
                  data.historyIncluded ? 'each with its edit history' : null,
                ]),
              },
              ...(data.paymentsIncluded
                ? [
                    {
                      count: data.counts.payments,
                      one: 'Payment',
                      many: 'Payments',
                      detail: 'Both amounts, currencies and stored rates',
                    },
                  ]
                : []),
              ...(data.deletedExpensesIncluded
                ? [
                    {
                      count: data.counts.deletedExpenses,
                      one: 'Deleted Expense',
                      many: 'Deleted Expenses',
                    },
                  ]
                : []),
            ]}
          />
          {data.currencyGroups?.length ? (
            <Box component="ul" sx={{ pl: 2.5, my: 1.5 }}>
              {data.currencyGroups.map((group, index) => (
                <li key={index}>
                  {group.name}: {[group.currency, ...group.alternateCurrencies].join(', ')}
                </li>
              ))}
            </Box>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            Not included: recurring Expense templates and Activity history.
          </Typography>
        </Box>
      )}
      {data?.format === 'csv' && !data.empty && (
        <ToggleButtonGroup
          exclusive
          size="small"
          value={csvView}
          aria-label="CSV preview format"
          onChange={(_, value: 'table' | 'text' | null) => {
            if (value) setCsvView(value);
          }}
        >
          <ToggleButton value="table">Table</ToggleButton>
          <ToggleButton value="text">Text</ToggleButton>
        </ToggleButtonGroup>
      )}
      {data?.format === 'csv' && data.files.length > 1 && (
        <Typography variant="body2" color="text.secondary">
          In one zip, {data.fileName}
        </Typography>
      )}
      {data?.format === 'csv' && data.files.some((file) => file.header.includes('Edited at')) && (
        <Typography variant="body2" color="text.secondary">
          Edit rows leave Amount blank.
        </Typography>
      )}
      {!data?.empty &&
        data?.format === 'csv' &&
        data.files.map((file) => (
          <Box key={file.name} sx={{ mt: 2 }}>
            <Typography
              component="h3"
              variant="subtitle2"
              sx={{ fontFamily: FONT_MONO, overflowWrap: 'anywhere', mb: 1 }}
            >
              {file.name}
            </Typography>
            {csvView === 'text' && file.text === undefined ? (
              <Typography color="text.secondary">
                This file is too large to show as text. Download it to see every row.
              </Typography>
            ) : csvView === 'text' ? (
              <Box
                component="pre"
                role="region"
                aria-label={`${file.name} text preview`}
                tabIndex={0}
                sx={{
                  m: 0,
                  overflow: 'auto',
                  maxHeight: 384,
                  fontFamily: FONT_MONO,
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'focus.main',
                    outlineOffset: 2,
                  },
                }}
              >
                {file.text}
              </Box>
            ) : (
              <PreviewTable label={`${file.name} preview`} headers={file.header}>
                {file.rows.map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, column) => (
                      <TableCell
                        key={column}
                        sx={{
                          whiteSpace: 'nowrap',
                          ...(/^(Amount)$| share$/.test(file.header[column])
                            ? { fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }
                            : {}),
                        }}
                      >
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </PreviewTable>
            )}
            {csvView === 'table' && file.kind === 'payments' && file.rows.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Cross-currency payments add Amount paid, Paid currency and Rate
              </Typography>
            )}
            {csvView === 'table' && file.totalRows > file.rows.length && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                …and {file.totalRows - file.rows.length} more rows
              </Typography>
            )}
          </Box>
        ))}
    </Box>
  );
}

/** Parts of a tile's detail line as one sentence, capitalised: "Since April 2026, each with…". */
function sentence(parts: (string | null)[]): string | undefined {
  const line = parts.filter(Boolean).join(', ');
  return line ? line[0].toUpperCase() + line.slice(1) : undefined;
}

interface BackupTile {
  count: number;
  one: string;
  many: string;
  detail?: string;
}

/**
 * What a backup holds, as count tiles: each number above its label, as the stat cards draw
 * figures (#646). A list, so a screen reader hears "3 Members" and how many tiles there are.
 */
function BackupCounts({ tiles }: { tiles: BackupTile[] }) {
  return (
    <Box
      component="ul"
      aria-label="What the backup holds"
      sx={{
        listStyle: 'none',
        p: 0,
        my: 2,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(140px, 100%), 1fr))',
        gap: 1.5,
      }}
    >
      {tiles.map((tile) => (
        <Box
          component="li"
          key={tile.many}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.25,
            minWidth: 0,
            p: '14px 16px',
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: `${RADIUS.lg}px`,
          }}
        >
          <Typography
            component="p"
            sx={(theme) => ({
              ...theme.typography.money,
              m: 0,
              fontSize: '1.5rem',
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              color: 'text.primary',
            })}
          >
            {tile.count}
          </Typography>
          <Typography
            component="p"
            sx={{ m: 0, fontSize: '0.8125rem', lineHeight: 1.4, color: 'text.secondary' }}
          >
            {tile.count === 1 ? tile.one : tile.many}
          </Typography>
          {tile.detail ? (
            <Typography
              component="p"
              sx={{ m: 0, fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' }}
            >
              {tile.detail}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
