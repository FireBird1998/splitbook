'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@/components/common/visually-hidden';

export interface ExpenseStat {
  term: string;
  /** Null while the figure loads. */
  value: ReactNode | null;
}

/**
 * Figures as a description list (design canvas `.gx-stats`): each term small and secondary, its
 * figure in IBM Plex Mono below it. The Month bar and the summary above an Expense list use it.
 */
export default function ExpenseStats({ stats }: { stats: ExpenseStat[] }) {
  return (
    <Box
      component="dl"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 28px', m: 0, minWidth: 0 }}
    >
      {stats.map(({ term, value }) => (
        <Box key={term} sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <Typography
            component="dt"
            sx={{ fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' }}
          >
            {term}
          </Typography>
          <Box component="dd" sx={{ m: 0, minHeight: 18 }}>
            {value ?? (
              <>
                <Skeleton variant="text" width={72} aria-hidden />
                <Box component="span" sx={visuallyHidden}>
                  Loading
                </Box>
              </>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** A count in the stats' figure style. */
export function StatCount({ value }: { value: number }) {
  return (
    <Typography
      component="span"
      sx={(theme) => ({
        ...theme.typography.money,
        fontSize: '0.875rem',
        lineHeight: 1.3,
        color: 'text.primary',
      })}
    >
      {value}
    </Typography>
  );
}
