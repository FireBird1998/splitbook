'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import Snackbar from '@mui/material/Snackbar';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { signOutToHome } from '@/lib/auth-client';

/** Why Sign Out left the member signed in, and what they're told. */
const PROBLEMS = {
  unreachable: 'Couldn’t sign out. Check your connection and try again.',
  refused: 'Couldn’t sign out. Try again.',
} as const;
export type SignOutProblem = keyof typeof PROBLEMS;

/**
 * Sign Out for the Account menu and Settings. When the tab can't leave, because the server
 * can't be reached (#536) or refuses to end the session (#550), the member stays signed in on the
 * page and `problem` says why.
 */
export function useSignOut() {
  const [problem, setProblem] = useState<SignOutProblem | null>(null);
  const signOut = () => {
    setProblem(null);
    signOutToHome().then(
      (outcome) => setProblem(outcome === 'leaving' ? null : outcome),
      () => setProblem('unreachable'),
    );
  };
  return { signOut, problem, dismiss: () => setProblem(null) };
}

/**
 * Tells the member Sign Out didn't end their session. The status region is always on the page,
 * so the message is announced politely each time it appears; the Snackbar is what they see.
 */
export function SignOutNotice({
  problem,
  onClose,
}: {
  problem: SignOutProblem | null;
  onClose(): void;
}) {
  // The Snackbar keeps its last words while it closes.
  const [shown, setShown] = useState(problem);
  if (problem && problem !== shown) setShown(problem);
  return (
    <>
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {problem ? PROBLEMS[problem] : ''}
      </Box>
      {/* Above any fixed bar of the page, as for the other notices. */}
      <Portal>
        <Snackbar
          open={problem !== null}
          autoHideDuration={6000}
          onClose={(_, reason) => {
            if (reason !== 'clickaway') onClose();
          }}
          message={shown ? PROBLEMS[shown] : undefined}
          // The status region announces it; the Snackbar mustn't again, assertively.
          slotProps={{ content: { role: 'presentation' } }}
        />
      </Portal>
    </>
  );
}
