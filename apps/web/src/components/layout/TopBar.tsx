'use client';

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
import BrandLogo from './BrandLogo';
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
 * the demo badge in demo mode, the theme switch and Add expense.
 */
export default function TopBar({ userId, demoMode, menuOpen, onOpenMenu }: TopBarProps) {
  const { mode, toggleTheme } = useThemeMode();
  const themeLabel = mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

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
        // A 360 px phone fits the menu button, logo, search, demo badge and theme switch on one
        // line. Below 360 px, in demo mode, the theme switch wraps onto a second line.
        '@media (max-width: 374.95px)': { gap: 0.5 },
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
      <Box sx={{ display: { xs: 'flex', lg: 'none' } }}>
        <BrandLogo height={32} href={HOME_HREF} />
      </Box>

      {/* Search (#321) fills the start of the bar: a field, or an icon button on phones. */}
      <SearchLauncher />

      {demoMode ? <DemoModeBadge compact /> : null}
      <Tooltip title={themeLabel}>
        <IconButton onClick={toggleTheme} aria-label={themeLabel} sx={iconButtonSx}>
          {mode === 'light' ? <DarkModeOutlinedIcon /> : <LightModeOutlinedIcon />}
        </IconButton>
      </Tooltip>
      <AddExpenseLauncher userId={userId} />
    </Box>
  );
}
