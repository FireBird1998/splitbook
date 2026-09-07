'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import MoneyText from '@/components/common/MoneyText';
import type { ExpenseMemberBreakdownRow } from '@splitbook/shared/types';

interface MonthMemberTableProps {
  rows: ExpenseMemberBreakdownRow[];
  currency: string;
  userId: string;
  /** Month label for copy, e.g. "August" — monthly figures are always qualified. */
  monthName: string;
}

/**
 * Per-member monthly breakdown (fronted / share / net) for the active month
 * of a Household group. These are descriptive monthly figures — never a
 * balance — so nothing here is labelled "balance"; the header's running
 * balance is the only number that carries that label.
 */
export default function MonthMemberTable({
  rows,
  currency,
  userId,
  monthName,
}: MonthMemberTableProps) {
  if (rows.length === 0) return null;

  return (
    <Paper variant="outlined" sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5 }}>
      <Typography
        variant="caption"
        fontWeight={600}
        color="text.disabled"
        sx={{
          display: 'block',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          mb: 1,
        }}
      >
        Per member · {monthName}
      </Typography>

      <Box
        role="table"
        aria-label={`Per-member breakdown for ${monthName}`}
        sx={{ display: 'grid', rowGap: 0.25 }}
      >
        <Box
          role="row"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) repeat(3, minmax(64px, 1fr))',
            columnGap: 1,
            pb: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box role="columnheader" />
          {['Fronted', 'Share', 'Net'].map((heading) => (
            <Typography
              key={heading}
              role="columnheader"
              variant="caption"
              color="text.disabled"
              sx={{ textAlign: 'right', fontWeight: 600 }}
            >
              {heading}
            </Typography>
          ))}
        </Box>

        {rows.map((row) => {
          const isYou = row.user._id === userId;
          const name = isYou ? 'You' : row.user.name.split(' ')[0];
          return (
            <Box
              role="row"
              key={row.user._id}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.4fr) repeat(3, minmax(64px, 1fr))',
                columnGap: 1,
                py: 0.75,
                alignItems: 'center',
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-of-type': { borderBottom: 'none' },
              }}
            >
              <Stack
                role="cell"
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ minWidth: 0 }}
              >
                <Avatar
                  src={row.user.image}
                  alt={row.user.name}
                  sx={{ width: 22, height: 22, fontSize: 11 }}
                >
                  {row.user.name?.[0]}
                </Avatar>
                <Typography variant="body2" fontWeight={isYou ? 700 : 500} noWrap>
                  {name}
                </Typography>
              </Stack>
              <MoneyText
                role="cell"
                amount={row.paid}
                currency={currency}
                tone="neutral"
                variant="body2"
                sx={{ textAlign: 'right', color: 'text.secondary' }}
              />
              <MoneyText
                role="cell"
                amount={row.share}
                currency={currency}
                tone="neutral"
                variant="body2"
                sx={{ textAlign: 'right', color: 'text.secondary' }}
              />
              <MoneyText
                role="cell"
                amount={row.net}
                currency={currency}
                signed
                variant="body2"
                fontWeight={600}
                sx={{ textAlign: 'right' }}
                aria-label={`${name} net in ${monthName}`}
              />
            </Box>
          );
        })}
      </Box>

      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
        Net in {monthName} = share − fronted, for this month&apos;s expenses only.
      </Typography>
    </Paper>
  );
}
