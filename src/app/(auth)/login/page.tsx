import { Suspense } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { isDemoMode } from '@/lib/auth-mode';
import LoginForm from '@/components/auth/LoginForm';
import DemoLoginClient from '@/components/auth/DemoLoginClient';

export default function LoginPage() {
  const demo = isDemoMode();

  return (
    <Suspense
      fallback={
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default',
          }}
        >
          <Box sx={{ textAlign: 'center' }}>
            <Typography component="span" sx={{ fontSize: '3rem', display: 'block', mb: 2 }}>
              💰
            </Typography>
            <Typography color="text.secondary">Loading...</Typography>
          </Box>
        </Box>
      }
    >
      {demo ? <DemoLoginClient /> : <LoginForm authMode="google" />}
    </Suspense>
  );
}
