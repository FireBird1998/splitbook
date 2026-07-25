'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import GoogleIcon from '@mui/icons-material/Google';
import type { AuthMode } from '@/lib/auth-mode';
import { getSignInProvider } from '@/lib/auth-sign-in';

interface LoginFormProps {
  authMode: AuthMode;
}

export default function LoginForm({ authMode }: LoginFormProps) {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const error = searchParams.get('error');
  const provider = getSignInProvider(authMode);

  const handleSignIn = () => {
    void signIn(provider, { callbackUrl });
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ textAlign: 'center', p: 4 }}>
        <Box sx={{ mb: 4 }}>
          <Typography component="span" sx={{ fontSize: '3rem', display: 'block', mb: 2 }}>
            💰
          </Typography>
          <Typography variant="h4" fontWeight={700} color="text.primary">
            SplitWise
          </Typography>
        </Box>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" color="text.primary" sx={{ mb: 1 }}>
            Welcome back!
          </Typography>
          <Typography color="text.secondary">Sign in to continue.</Typography>
        </Box>

        {error && (
          <Box
            sx={{
              bgcolor: (theme) => `${theme.palette.error.main}12`,
              color: 'error.main',
              px: 2,
              py: 1.5,
              borderRadius: 2,
              fontSize: '0.875rem',
              mb: 4,
            }}
          >
            Something went wrong. Please try again.
          </Box>
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<GoogleIcon />}
          onClick={handleSignIn}
          sx={{
            fontSize: '1rem',
            py: 1.5,
            px: 3,
            maxWidth: 320,
          }}
        >
          Sign in with Google
        </Button>

        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: 'block', maxWidth: 320, mx: 'auto', mt: 4 }}
        >
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </Typography>
      </Box>
    </Box>
  );
}
