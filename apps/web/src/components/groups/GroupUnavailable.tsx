import type { ElementType, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/**
 * A Group the member can't open (#201): one look and one wording wherever that happens, on the
 * Group page, its settings, and a Group's server page refused with a 403 (the statement, #319).
 * It never says which it is (deleted, never joined, or left), so it never reveals whether the
 * Group exists.
 */
export default function GroupUnavailable({
  headingComponent = 'h6',
  action,
}: {
  /** The heading's element: `h1` where the refusal is the whole page. */
  headingComponent?: ElementType;
  /** Where to go instead, such as Home. */
  action?: ReactNode;
}) {
  return (
    <Box sx={{ textAlign: 'center', py: 6 }}>
      <Typography
        variant="h6"
        component={headingComponent}
        fontWeight={500}
        color="text.primary"
        sx={{ mb: 1 }}
      >
        Group not found
      </Typography>
      <Typography color="text.secondary">
        This group may have been deleted or you don&apos;t have access.
      </Typography>
      {action ? <Box sx={{ mt: 3 }}>{action}</Box> : null}
    </Box>
  );
}
