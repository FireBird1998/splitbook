'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import Snackbar from '@mui/material/Snackbar';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { signOutToHome } from '@/lib/auth-client';

const UNREACHABLE = 'Couldn’t sign out. Check your connection and try again.';

/**
 * Sign Out for the Account menu and Settings. When the tab can't leave, as when the server can't
 * be reached, the member stays signed in on the page and `unreachable` is set (#536).
 */
export function useSignOut() {
  const [unreachable, setUnreachable] = useState(false);
  const signOut = () => {
    setUnreachable(false);
    signOutToHome().then(
      (outcome) => setUnreachable(outcome === 'unreachable'),
      () => setUnreachable(true),
    );
  };
  return { signOut, unreachable, dismiss: () => setUnreachable(false) };
}

/**
 * Tells the member Sign Out couldn't reach the server. The status region is always on the page,
 * so the message is announced politely each time it appears; the Snackbar is what they see.
 */
export function SignOutNotice({ unreachable, onClose }: { unreachable: boolean; onClose(): void }) {
  return (
    <>
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {unreachable ? UNREACHABLE : ''}
      </Box>
      {/* Above any fixed bar of the page, as for the other notices. */}
      <Portal>
        <Snackbar
          open={unreachable}
          autoHideDuration={6000}
          onClose={(_, reason) => {
            if (reason !== 'clickaway') onClose();
          }}
          message={UNREACHABLE}
          // The status region announces it; the Snackbar mustn't again, assertively.
          slotProps={{ content: { role: 'presentation' } }}
        />
      </Portal>
    </>
  );
}
