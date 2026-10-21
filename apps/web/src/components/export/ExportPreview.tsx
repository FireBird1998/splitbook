import { isEmptyStatementCurrency } from '@splitbook/shared/statement';
('use client');
import ExportPaymentDescription from './ExportPaymentDescription';
import { useState, type ReactNode } from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import MoneyText from '@/components/common/MoneyText';
import { toMajorAmount } from '@splitbook/shared/exact-money';
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
    : `${data.from} – ${data.to}`;
}
function PreviewTable({
  label,
  headers,
  children,
}: {
  label: string;
  headers: string[];
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
        sx={{ minWidth: 'max-content', '& td, & th': { whiteSpace: 'nowrap' } }}
      >
        <TableHead>
          <TableRow>
            {headers.map((header, i) => (
              <TableCell key={i} component="th" scope="col" sx={{ whiteSpace: 'nowrap' }}>
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
/** The Statement’s generation instant in the export’s chosen zone, day first. */
function generatedTime(at: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)!.value;
  return `${part('day')} ${part('month')} ${part('year')} at ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
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
              ? `${data.groupNames.join(', ')} · ${previewPeriod(data)} · ${formats[data.format]}`
              : undefined
          }
          sx={{ mb: 2 }}
        >
          {data
            ? `${data.groupNames.join(', ')} · ${previewPeriod(data)} · ${formats[data.format]}`
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
            {data.statement.name} · Statement · {previewPeriod(data)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {getGroupTheme(data.statement.theme).label} · {data.statement.defaultCurrency} ·
            Generated {generatedTime(data.generatedAt, data.timeZone)} ({data.timeZone})
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
            const name = (id: string) =>
              bucket.people.find((person) => person.id === id)?.name ?? 'Former member';
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
                      amount={toMajorAmount(bucket.spentMinor, bucket.currency)}
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
                    <Typography component="span">{bucket.paymentCount} · </Typography>
                    <MoneyText
                      amount={toMajorAmount(bucket.paymentTotalMinor, bucket.currency)}
                      currency={bucket.currency}
                      tone="neutral"
                    />
                  </Box>
                </Box>
                <PreviewTable
                  label={`${bucket.currency} period contributions`}
                  headers={['Member', 'Paid', 'Share', 'Net']}
                >
                  {bucket.people.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell component="th" scope="row">
                        {person.name}
                      </TableCell>
                      {[person.paidMinor, person.shareMinor, person.netMinor].map((minor, i) => (
                        <TableCell key={i}>
                          <MoneyText
                            amount={toMajorAmount(minor, bucket.currency)}
                            currency={bucket.currency}
                            tone="neutral"
                          />
                        </TableCell>
                      ))}
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
                  >
                    {bucket.people.map((person) => (
                      <TableRow key={person.id}>
                        <TableCell component="th" scope="row">
                          {person.name}
                        </TableCell>
                        <TableCell>
                          <MoneyText
                            amount={toMajorAmount(person.balanceMinor, bucket.currency)}
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
                            amount={toMajorAmount(payment.amountMinor, bucket.currency)}
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
                            {generatedTime(payment.at, data.timeZone)}
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
                                  amount={toMajorAmount(payment.amountMinor, bucket.currency)}
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
                      headers={['Date', 'Description', 'Tag', 'Amount', 'Paid by', 'Share']}
                    >
                      {bucket.expenses.map((expense) => (
                        <TableRow key={expense.id}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{expense.date}</TableCell>
                          <TableCell>{expense.description}</TableCell>
                          <TableCell>{expense.tag}</TableCell>
                          <TableCell>
                            <MoneyText
                              amount={toMajorAmount(expense.amountMinor, bucket.currency)}
                              currency={bucket.currency}
                              tone="neutral"
                            />
                          </TableCell>
                          {[expense.paidBy, expense.splitBetween].map((allocations, index) => (
                            <TableCell key={index}>
                              {allocations.map((person) => (
                                <Box key={person.userId}>
                                  {name(person.userId)}{' '}
                                  <MoneyText
                                    amount={toMajorAmount(person.amountMinor, bucket.currency)}
                                    currency={bucket.currency}
                                    tone="neutral"
                                  />
                                </Box>
                              ))}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
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
          <Box component="ul" sx={{ pl: 2.5 }}>
            {data.currencyGroups?.map((group, index) => (
              <li key={index}>
                {group.name}: {[group.currency, ...group.alternateCurrencies].join(', ')}
              </li>
            ))}
            <li>{data.counts.members} Members</li>
            <li>
              {data.counts.expenses} Expenses
              {data.earliestMonth
                ? ` since ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.earliestMonth}-15T12:00:00Z`))}`
                : ''}
              {data.historyIncluded ? ', each with its edit history' : ''}
            </li>
            {data.paymentsIncluded && (
              <li>
                {data.counts.payments} Payments, including both amounts, currencies and stored rates
              </li>
            )}
            {data.deletedExpensesIncluded && (
              <li>
                {data.counts.deletedExpenses} Deleted{' '}
                {data.counts.deletedExpenses === 1 ? 'Expense' : 'Expenses'}
              </li>
            )}
          </Box>
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
