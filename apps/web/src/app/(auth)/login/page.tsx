import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import BrandMark from '@/components/layout/BrandMark';
import { isDemoMode } from '@/lib/auth-mode';
import LoginForm from '@/components/auth/LoginForm';
import DemoLoginClient from '@/components/auth/DemoLoginClient';
import { getAuthUser } from '@/lib/utils/api-response';

// Auth mode is runtime deployment configuration, not a build-time page choice.
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getAuthUser()) redirect('/dashboard');
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
            <BrandMark size={44} fontSize={20} />
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              Loading...
            </Typography>
          </Box>
        </Box>
      }
    >
      {demo ? <DemoLoginClient /> : <LoginForm />}
    </Suspense>
  );
}
