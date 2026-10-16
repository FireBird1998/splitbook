'use client';

import Button from '@mui/material/Button';
import GoogleIcon from '@mui/icons-material/Google';
import { signInWithGoogle } from '@/lib/auth-client';
import { LANDING_ACTION_HEIGHT } from './landing-copy';

/** The landing page's primary action: Google sign-in, landing on Home. */
export default function SignInWithGoogleButton() {
  return (
    <Button
      variant="contained"
      size="large"
      startIcon={<GoogleIcon />}
      onClick={() => void signInWithGoogle('/dashboard')}
      sx={{ minHeight: LANDING_ACTION_HEIGHT, px: 3 }}
    >
      Sign in with Google
    </Button>
  );
}
