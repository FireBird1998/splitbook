'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import { useThemeMode } from '@/providers/ThemeProvider';
import DemoModeBadge from '@/components/demo/DemoModeBadge';
import AddExpenseLauncher from '@/components/expenses/AddExpenseLauncher';
import SearchLauncher from '@/components/search/SearchLauncher';
import { TOPBAR_HEIGHT } from '@/lib/theme/tokens';
import { PRODUCT_NAME } from '@/lib/product';
import BrandLogo from './BrandLogo';
import BrandMark from './BrandMark';
import { MARK_ONLY, THEME_IN_DRAWER, TIGHT_BAR, themeSwitchLabel } from './phone-top-bar';
import { HOME_HREF } from './shell-nav';

/** A top bar icon button (web.css: .iconbtn): 44 px, rounded, secondary until hovered. */
const iconButtonSx = {
  width: 44,
  height: 44,
  flex: 'none',
  borderRadius: '12px',
  color: 'text.secondary',
  '&:hover': { bgcolor: 'surface.muted', color: 'text.primary' },
} as const;

interface TopBarProps {
  userId: string;
  demoMode: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
}

/**
 * The bar across the top of the main column: on phones the menu button and the logo, then
 * search, the demo badge in demo mode, the theme switch (in the drawer on a narrow phone) and
 * Add expense.
 */
export default function TopBar({ userId, demoMode, menuOpen, onOpenMenu }: TopBarProps) {
  const { mode, toggleTheme } = useThemeMode();
  const themeLabel = themeSwitchLabel(mode);

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 'appBar',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: { xs: 1, sm: 1.5 },
        // A phone's bar stays on one line from 320 px up (see phone-top-bar.ts).
        [TIGHT_BAR]: { gap: 0.5 },
        minHeight: TOPBAR_HEIGHT,
        px: { xs: 2, lg: 4 },
        py: { xs: 1.25, lg: 1.5 },
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'surface.elevated',
      }}
    >
      <IconButton
        onClick={onOpenMenu}
        aria-label="Open navigation menu"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        sx={{ ...iconButtonSx, display: { xs: 'inline-flex', lg: 'none' }, ml: -1 }}
      >
        <MenuIcon />
      </IconButton>
      <Box sx={{ display: { xs: 'flex', lg: 'none' }, [MARK_ONLY]: { display: 'none' } }}>
        <BrandLogo height={32} href={HOME_HREF} />
      </Box>
      <Box
        component={Link}
        href={HOME_HREF}
        aria-label={`${PRODUCT_NAME} home`}
        // The mark's clear space (a quarter of its size) with the bar's gaps either side.
        sx={{ display: 'none', [MARK_ONLY]: { display: 'flex' }, p: '4px', borderRadius: 1 }}
      >
        <BrandMark size={32} />
      </Box>

      {/* Search (#321) fills the start of the bar: a field, or an icon button on phones. */}
      <SearchLauncher />

      {demoMode ? <DemoModeBadge compact /> : null}
      <Tooltip title={themeLabel}>
        <IconButton
          onClick={toggleTheme}
          aria-label={themeLabel}
          // On a narrow phone it is in the drawer instead.
          sx={{ ...iconButtonSx, [THEME_IN_DRAWER]: { display: 'none' } }}
        >
          {mode === 'light' ? <DarkModeOutlinedIcon /> : <LightModeOutlinedIcon />}
        </IconButton>
      </Tooltip>
      <AddExpenseLauncher userId={userId} />
    </Box>
  );
}
