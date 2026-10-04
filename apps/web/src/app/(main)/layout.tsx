import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Sidebar from '@/components/layout/Sidebar';
import Navbar from '@/components/layout/Navbar';
import ExpectedAccountProvider from '@/components/layout/ExpectedAccountProvider';
import SessionGuard from '@/components/layout/SessionGuard';
import SettlementAttemptsOwner from '@/components/settlements/SettlementAttemptsOwner';
import { isDemoMode } from '@/lib/auth-mode';
import { NAV_HEIGHT, SIDEBAR_WIDTH } from '@/lib/theme/tokens';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <ExpectedAccountProvider accountId={user.id}>
      <SessionGuard accountId={user.id} />
      <SettlementAttemptsOwner accountId={user.id} />
      <Box
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          overflowX: 'hidden',
        }}
      >
        <Navbar user={user} demoMode={isDemoMode()} />
        {/* Spacer for fixed navbar */}
        <Box sx={{ height: NAV_HEIGHT }} />
        <Box sx={{ display: 'flex' }}>
          <Sidebar />
          <Box
            component="main"
            sx={{
              flex: 1,
              p: { xs: 2, sm: 3 },
              ml: { xs: 0, lg: `${SIDEBAR_WIDTH}px` },
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    </ExpectedAccountProvider>
  );
}
