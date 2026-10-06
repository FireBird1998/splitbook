'use client';

import { useState, type PropsWithChildren } from 'react';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { CONTENT_MAX_WIDTH, SIDEBAR_WIDTH } from '@/lib/theme/tokens';
import type { ShellUser } from './AccountMenu';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

type AppShellProps = PropsWithChildren<{
  user: ShellUser & { id: string };
  demoMode: boolean;
}>;

/**
 * The frame around every signed-in page (design canvas "Web portal", #303): a full-height
 * sidebar on desktop, and a main column holding the top bar and the page, up to 1320 px wide.
 * Below the desktop breakpoint the sidebar is a drawer opened from the top bar.
 */
export default function AppShell({ user, demoMode, children }: AppShellProps) {
  const pathname = usePathname();
  const theme = useTheme();
  // False on the server and while hydrating, so desktop never flashes without its sidebar.
  // Phones then drop the hidden sidebar, leaving each Group's name in the page only once.
  const phone = useMediaQuery(theme.breakpoints.down('lg'));
  // The drawer belongs to the page it was opened on: navigating anywhere (a link, Back)
  // closes it, and coming back to that page later doesn't reopen it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  if (drawerPath !== null && drawerPath !== pathname) setDrawerPath(null);
  const drawerOpen = phone && drawerPath === pathname;
  const closeDrawer = () => setDrawerPath(null);

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        bgcolor: 'background.default',
        // Clip, not hide: hiding would make this a scroll container and unstick the bars.
        overflowX: 'clip',
      }}
    >
      {phone ? null : (
        <Box
          component="aside"
          aria-label="Splitbook"
          sx={{
            display: { xs: 'none', lg: 'block' },
            flex: 'none',
            width: SIDEBAR_WIDTH,
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'surface.elevated',
          }}
        >
          {/* The column runs the page's full height; its contents stay in view as it scrolls. */}
          <Box sx={{ position: 'sticky', top: 0, height: '100vh' }}>
            <Sidebar user={user} pathname={pathname} />
          </Box>
        </Box>
      )}

      <Box sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar
          userId={user.id}
          demoMode={demoMode}
          menuOpen={drawerOpen}
          onOpenMenu={() => setDrawerPath(pathname)}
        />
        <Box
          component="main"
          sx={{
            flex: '1 1 auto',
            width: '100%',
            maxWidth: CONTENT_MAX_WIDTH,
            mx: 'auto',
            px: { xs: 2, sm: 3, lg: 4 },
            pt: { xs: 2, sm: 3 },
            pb: { xs: 5, lg: 7 },
          }}
        >
          {children}
        </Box>
      </Box>

      {phone ? (
        <Drawer
          anchor="left"
          open={drawerOpen}
          onClose={closeDrawer}
          slotProps={{
            paper: {
              role: 'dialog',
              'aria-modal': true,
              'aria-label': 'Navigation menu',
              sx: {
                width: SIDEBAR_WIDTH,
                maxWidth: '85vw',
                bgcolor: 'surface.elevated',
                backgroundImage: 'none',
              },
            },
          }}
        >
          <Sidebar
            user={user}
            pathname={pathname}
            variant="drawer"
            onNavigate={closeDrawer}
            onClose={closeDrawer}
          />
        </Drawer>
      ) : null}
    </Box>
  );
}
