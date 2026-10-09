'use client';
import { useState, type ReactNode } from 'react';
import GlobalStyles from '@mui/material/GlobalStyles';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import MoneyText from '@/components/common/MoneyText';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { getSemanticTokens } from '@/lib/theme/tokens';
import { zonedTimestamp } from '@splitbook/shared/export-csv';
import type { OutsideTrip, Statement } from '@splitbook/shared/statement';

const light = getSemanticTokens('light');
/** A whole trip's Expenses and Payments outside the Trip's dates. */
const OUTSIDE_TRIP: Record<OutsideTrip, string> = {
  before: 'Before the trip',
  after: 'After the trip',
};
const expenses = (count: number) => `${count} ${count === 1 ? 'Expense' : 'Expenses'}`;
function StatementTable({
  title,
  headers,
  children,
}: {
  title: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <Box
      className="statement-table-region"
      role="region"
      aria-label={title}
      tabIndex={0}
      sx={{
        overflowX: 'auto',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'focus.main', outlineOffset: 2 },
      }}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            {headers.map((header) => (
              <TableCell key={header} component="th" scope="col">
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
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 3 }}>
      <Typography component="h2" variant="h6" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
export default function StatementView({ statement }: { statement: Statement }) {
  const [currency, setCurrency] = useState(statement.defaultCurrency);
  const bucket = statement.currencies.find((row) => row.currency === currency)!;
  const name = (id: string) => bucket.people.find((row) => row.id === id)?.name ?? 'Former member';
  const amount = (minor: number) => (
    <MoneyText amount={toMajorAmount(minor, currency)} currency={currency} tone="neutral" />
  );
  return (
    <Box
      className="statement-paper"
      sx={{
        bgcolor: 'background.paper',
        color: 'text.primary',
        p: { xs: 2, md: 3 },
        borderRadius: 2,
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
      <Typography component="h1" variant="h4">
        {statement.name} · Statement
      </Typography>
      <Typography color="text.secondary">
        {statement.from && statement.to ? `${statement.from} – ${statement.to}` : 'All time'} ·{' '}
        {currency} · {statement.timeZone}
      </Typography>
      {statement.wholeTrip ? (
        <Typography>Whole trip, including Expenses before and after the Trip’s dates.</Typography>
      ) : null}
      <Box className="statement-controls" sx={{ display: 'flex', gap: 2, my: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
        {statement.currencies.length > 1 ? (
          <TextField
            select
            label="Currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            {statement.currencies.map((row) => (
              <option key={row.currency}>{row.currency}</option>
            ))}
          </TextField>
        ) : null}
      </Box>
      <Section title="Summary">
        <Typography>Spent: {amount(bucket.spentMinor)}</Typography>
        <Typography>Expenses: {bucket.expenseCount}</Typography>
        {(['before', 'after'] as const).map((part) => {
          const outside = part === 'before' ? bucket.beforeTrip : bucket.afterTrip;
          return outside ? (
            <Typography key={part} color="text.secondary">
              {OUTSIDE_TRIP[part]}: {amount(outside.spentMinor)} · {expenses(outside.expenseCount)},
              counted in Spent
            </Typography>
          ) : null;
        })}
        <Typography>
          Payments: {bucket.payments.length} · {amount(bucket.paymentTotalMinor)}
        </Typography>
      </Section>
      <Section title="Paid, Share and Net">
        <Typography color="text.secondary">
          Expense contributions for this period. Net is Paid minus Share.
        </Typography>
        <StatementTable title="People’s contributions" headers={['Person', 'Paid', 'Share', 'Net']}>
          {bucket.people.map((person) => (
            <TableRow key={person.id}>
              <TableCell component="th" scope="row">
                {person.name}
              </TableCell>
              <TableCell>{amount(person.paidMinor)}</TableCell>
              <TableCell>{amount(person.shareMinor)}</TableCell>
              <TableCell>{amount(person.netMinor)}</TableCell>
            </TableRow>
          ))}
        </StatementTable>
      </Section>
      <Section title="Balances and suggested payments">
        <Typography color="text.secondary">
          Current all-time positions, including every recorded payment. These match Balances; the
          period changes spending only.
        </Typography>
        <StatementTable title="Current balances" headers={['Person', 'Balance']}>
          {bucket.people.map((person) => (
            <TableRow key={person.id}>
              <TableCell component="th" scope="row">
                {person.name}
              </TableCell>
              <TableCell>{amount(person.balanceMinor)}</TableCell>
            </TableRow>
          ))}
        </StatementTable>
        {bucket.suggestedPayments.length ? (
          <Box component="ul">
            {bucket.suggestedPayments.map((row) => (
              <li key={`${row.from}-${row.to}`}>
                {name(row.from)} pays {name(row.to)} {amount(row.amountMinor)}
              </li>
            ))}
          </Box>
        ) : (
          <Typography>Settled up.</Typography>
        )}
      </Section>
      <Section title="Expenses with shares">
        {bucket.expenses.length ? (
          <StatementTable
            title="Expense details"
            headers={['Date', 'Expense', 'Paid by', 'Amount', 'Shares']}
          >
            {bucket.expenses.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.date}
                  {row.outsideTrip ? (
                    <Typography variant="caption" component="div">
                      {OUTSIDE_TRIP[row.outsideTrip]}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell component="th" scope="row">
                  {row.description}
                  <Typography variant="caption" component="div">
                    {row.category} · {row.tag}
                  </Typography>
                </TableCell>
                <TableCell>
                  {row.paidBy.map((person) => (
                    <div key={person.userId}>
                      {name(person.userId)} {amount(person.amountMinor)}
                    </div>
                  ))}
                </TableCell>
                <TableCell>{amount(row.amountMinor)}</TableCell>
                <TableCell>
                  {row.splitBetween.map((person) => (
                    <div key={person.userId}>
                      {name(person.userId)} {amount(person.amountMinor)}
                    </div>
                  ))}
                </TableCell>
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
            headers={['Date and time', 'From', 'To', 'Amount', 'Note', 'Recorded by']}
          >
            {bucket.payments.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {zonedTimestamp(row.at, statement.timeZone)}
                  {row.outsideTrip ? (
                    <Typography variant="caption" component="div">
                      {OUTSIDE_TRIP[row.outsideTrip]}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>{name(row.fromId)}</TableCell>
                <TableCell>{name(row.toId)}</TableCell>
                <TableCell>{amount(row.amountMinor)}</TableCell>
                <TableCell>{row.note}</TableCell>
                <TableCell>{name(row.recordedById)}</TableCell>
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
