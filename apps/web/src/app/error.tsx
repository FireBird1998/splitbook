'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import {
  DATABASE_UNAVAILABLE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from '@splitbook/shared/database-unavailable';

/**
 * A server page that couldn't reach the database, even after its one retry (#826): the page's
 * layout reads the session first, and any page may read more. Next.js hides a server error's
 * message from the browser but keeps its digest, which `DatabaseUnavailableError` sets. The page
 * says so in the owner's words and offers Try again, which loads it again, within about 5 s
 * rather than the 30 s hang that ended in "This page couldn't load".
 *
 * Any other error is thrown on, to Next.js's own page for a server error, as before.
 */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  if (error.digest !== DATABASE_UNAVAILABLE) throw error;
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        p: 3,
        bgcolor: 'background.default',
      }}
    >
      <Box role="alert" sx={{ display: 'grid', gap: 2, justifyItems: 'center', maxWidth: 420 }}>
        <Typography component="h1" variant="h6" color="text.primary" textAlign="center">
          {DATABASE_UNAVAILABLE_MESSAGE}
        </Typography>
        <Button variant="contained" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </Box>
    </Box>
  );
}
