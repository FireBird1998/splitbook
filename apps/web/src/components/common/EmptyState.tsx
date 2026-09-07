import type { ReactNode } from 'react';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

interface EmptyStateProps {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}

/** Absence of data is not a success notification or a failed request. */
export default function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Stack
      spacing={1.5}
      alignItems="center"
      sx={{ py: { xs: 3, sm: 5 }, px: 2, textAlign: 'center' }}
    >
      <Typography component="h3" variant="subtitle1">
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {description}
      </Typography>
      {action}
    </Stack>
  );
}
