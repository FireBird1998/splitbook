import type { ReactNode } from 'react';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/** A setup's numbered steps, in the guides' outlined card (#619). */
export function SetupSteps({ children }: { children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack component="ol" spacing={3} sx={{ pl: 3, my: 0 }}>
        {children}
      </Stack>
    </Paper>
  );
}

/** One numbered step, titled. */
export function SetupStep({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack component="li" spacing={1} sx={{ display: 'list-item' }}>
      <Typography component="h2" variant="h6">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}
