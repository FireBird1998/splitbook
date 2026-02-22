import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Sidebar from '@/components/layout/Sidebar';
import Navbar from '@/components/layout/Navbar';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        overflowX: 'hidden',
      }}
    >
      <Navbar user={session.user} />
      {/* Spacer for fixed navbar */}
      <Box sx={{ height: 56 }} />
      <Box sx={{ display: 'flex' }}>
        <Sidebar />
        <Box
          component="main"
          sx={{
            flex: 1,
            p: { xs: 2, sm: 3 },
            ml: { xs: 0, lg: '240px' },
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
