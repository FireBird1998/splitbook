'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { useThemeMode } from '@/providers/ThemeProvider';
import BrandLogo from './BrandLogo';
import AccountMenu, { type ShellUser } from './AccountMenu';
import { THEME_IN_BAR, themeSwitchLabel } from './phone-top-bar';
import SidebarGroups from './SidebarGroups';
import { EXPORT_HREF, HOME_HREF, MAIN_NAV, SETTINGS_HREF, navCurrent } from './shell-nav';

const NAV_ICONS = {
  [HOME_HREF]: DashboardOutlinedIcon,
  [EXPORT_HREF]: IosShareOutlinedIcon,
} as const;

/** A sidebar link (web.css: .nav-a): 44 px high, and tinted brand when it is the current page. */
const navLinkSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  minHeight: 44,
  px: 1.5,
  borderRadius: '10px',
  color: 'text.secondary',
  fontSize: '0.875rem',
  fontWeight: 500,
  textDecoration: 'none',
  '&:hover': { bgcolor: 'surface.hover', color: 'text.primary' },
  '&[aria-current="page"]': { bgcolor: 'tint.brand', color: 'primary.main', fontWeight: 600 },
} as const;

interface SidebarProps {
  user: ShellUser & { id: string };
  pathname: string;
  /** The phone drawer's copy: a close button, and every target at least 44 px. */
  variant?: 'desktop' | 'drawer';
  /** Called as any link is followed, so the drawer closes on navigation. */
  onNavigate?: () => void;
  onClose?: () => void;
}

/**
 * The shell's sidebar (design canvas "Web portal"): the logo linking Home, the main
 * navigation, the member's Groups with their balances, and Settings and the account at the
 * foot. The desktop sidebar and the phone drawer render the same items.
 */
export default function Sidebar({
  user,
  pathname,
  variant = 'desktop',
  onNavigate,
  onClose,
}: SidebarProps) {
  const drawer = variant === 'drawer';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        height: '100%',
        minHeight: 0,
        pt: 2,
        px: 1.5,
        pb: 3,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pl: '10px',
          pt: drawer ? 0 : 0.5,
        }}
      >
        <BrandLogo
          height={32}
          href={HOME_HREF}
          onClick={onNavigate}
          linkSx={drawer ? { minHeight: 44, alignItems: 'center' } : undefined}
        />
        {drawer ? (
          <IconButton
            onClick={onClose}
            aria-label="Close navigation menu"
            sx={{ width: 44, height: 44, borderRadius: '12px', color: 'text.secondary' }}
          >
            <CloseIcon />
          </IconButton>
        ) : null}
      </Box>

      <Box
        component="nav"
        aria-label="Main"
        sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
      >
        {MAIN_NAV.map((item) => {
          const Icon = NAV_ICONS[item.href];
          return (
            <Box
              key={item.href}
              component={Link}
              href={item.href}
              onClick={onNavigate}
              aria-current={navCurrent(pathname, item.href)}
              sx={navLinkSx}
            >
              <Icon sx={{ fontSize: 20 }} />
              {item.label}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <SidebarGroups
          userId={user.id}
          pathname={pathname}
          touch={drawer}
          onNavigate={onNavigate}
        />
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          borderTop: 1,
          borderColor: 'divider',
          pt: 1.5,
        }}
      >
        <Box
          component={Link}
          href={SETTINGS_HREF}
          onClick={onNavigate}
          aria-current={navCurrent(pathname, SETTINGS_HREF)}
          sx={navLinkSx}
        >
          <SettingsOutlinedIcon sx={{ fontSize: 20 }} />
          Settings
        </Box>
        {drawer ? <DrawerThemeSwitch /> : null}
        <AccountMenu user={user} onNavigate={onNavigate} />
      </Box>
    </Box>
  );
}

/**
 * The theme switch on a narrow phone, where the top bar has no room for it (phone-top-bar.ts):
 * the same name and icon as the bar's, naming the mode it moves to. Wider screens keep the
 * bar's switch, so the drawer shows none.
 */
function DrawerThemeSwitch() {
  const { mode, toggleTheme } = useThemeMode();
  const Icon = mode === 'light' ? DarkModeOutlinedIcon : LightModeOutlinedIcon;
  return (
    <Box
      component="button"
      type="button"
      onClick={toggleTheme}
      sx={{
        ...navLinkSx,
        width: '100%',
        border: 0,
        bgcolor: 'transparent',
        // The family only: the shorthand would undo the link's size.
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        [THEME_IN_BAR]: { display: 'none' },
      }}
    >
      <Icon sx={{ fontSize: 20 }} />
      {themeSwitchLabel(mode)}
    </Box>
  );
}
