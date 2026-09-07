'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_HEIGHT, SIDEBAR_WIDTH, RADIUS } from '@/lib/theme/tokens';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupIcon from '@mui/icons-material/Group';
import SettingsIcon from '@mui/icons-material/Settings';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { href: '/groups', label: 'Groups', icon: GroupIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <Box
      component="aside"
      sx={{
        display: { xs: 'none', lg: 'flex' },
        flexDirection: 'column',
        width: SIDEBAR_WIDTH,
        position: 'fixed',
        top: NAV_HEIGHT,
        bottom: 0,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        p: 2,
        pt: 3,
      }}
    >
      <Stack component="nav" aria-label="Primary" spacing={0.5}>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;

          return (
            <Box
              key={item.href}
              component={Link}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                minHeight: 44,
                borderRadius: `${RADIUS.sm}px`,
                fontSize: '0.875rem',
                fontWeight: isActive ? 600 : 500,
                textDecoration: 'none',
                transition: 'background-color 0.15s, color 0.15s',
                ...(isActive
                  ? {
                      bgcolor: 'tint.brand',
                      color: 'primary.main',
                    }
                  : {
                      color: 'text.secondary',
                      '&:hover': {
                        bgcolor: 'action.hover',
                        color: 'text.primary',
                      },
                    }),
              }}
            >
              <Icon fontSize="small" />
              {item.label}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
