'use client';

import { useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import GoogleIcon from '@mui/icons-material/Google';
import BrandMark from '@/components/layout/BrandMark';
import { EMAIL_NOT_ALLOWED } from '@/lib/auth/allowlist';
import { resolveCallbackUrl } from '@/lib/auth/callback-url';
import { signInWithGoogle } from '@/lib/auth-client';
import { PRODUCT_NAME } from '@/lib/product';

/** Google sign-in; demo mode renders the persona picker instead (see the login page). */
export default function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = resolveCallbackUrl(searchParams.get('callbackUrl'));
  // Better Auth appends `?error=<code>` after a rejected callback.
  const error = searchParams.get('error');
  const isAccessDenied = error === EMAIL_NOT_ALLOWED;

  const handleSignIn = () => {
    void signInWithGoogle(callbackUrl);
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
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={1.5}>
            <BrandMark size={44} fontSize={20} />
            <Typography variant="h4" fontWeight={700} color="text.primary">
              {PRODUCT_NAME}
            </Typography>
          </Stack>
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
            {isAccessDenied ? (
              <Stack spacing={0.5}>
                <Typography component="span" fontWeight={600}>
                  {PRODUCT_NAME} is invite-only right now.
                </Typography>
                <Typography component="span" variant="body2">
                  Ask the owner to add your Google email to the beta.
                </Typography>
              </Stack>
            ) : (
              'Something went wrong. Please try again.'
            )}
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
