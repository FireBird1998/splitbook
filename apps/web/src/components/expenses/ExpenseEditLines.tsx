import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ExpenseEditLine } from '@splitbook/shared/expense-detail';

/** A line's value, in the money face when it is an amount; a word such as "Not included" isn't. */
function Value({ value, money }: { value: string; money?: boolean }) {
  if (!money) return <>{value}</>;
  return (
    <Box component="span" sx={(theme) => theme.typography.money}>
      {value}
    </Box>
  );
}

/**
 * Under an edit in an Expense's history, what it changed, one short line per fact, as the side
 * panel, the phone card and Android all read it (#515): "Amount ₹900.00 → ₹1,200.00",
 * "Your share ₹300.00 → ₹400.00", "Notes changed".
 */
export default function ExpenseEditLines({ lines }: { lines: ExpenseEditLine[] }) {
  if (lines.length === 0) return null;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {lines.map(({ label, before, after, money }, index) => (
        <Typography
          key={index}
          component="li"
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', overflowWrap: 'anywhere' }}
        >
          {label}{' '}
          {before !== undefined && after !== undefined ? (
            <>
              <Value value={before} money={money?.before} /> →{' '}
              <Value value={after} money={money?.after} />
            </>
          ) : (
            (after ?? 'changed')
          )}
        </Typography>
      ))}
    </Box>
  );
}
