'use client';

import Link from 'next/link';
import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import LogoutIcon from '@mui/icons-material/Logout';
import SettingsIcon from '@mui/icons-material/Settings';
import { signOutToHome } from '@/lib/auth-client';
import { SETTINGS_HREF } from './shell-nav';

export interface ShellUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/** "Alex Rivera" → "AR": the avatar's letters when there is no picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

interface AccountMenuProps {
  user: ShellUser;
  /** The phone drawer: the menu's own links close it. */
  onNavigate?: () => void;
}

/**
 * The account at the foot of the sidebar: the member's avatar and name, opening the account
 * menu (who is signed in, Settings and Sign out). Sign out is the same call, with the same
 * handling, as the navbar's before #303.
 */
export default function AccountMenu({ user, onNavigate }: AccountMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const name = user.name || user.email || 'Account';

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={(event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
        aria-label={`${name}, account menu`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          width: '100%',
          minHeight: 44,
          px: 1.5,
          border: 0,
          borderRadius: '10px',
          bgcolor: 'transparent',
          color: 'text.secondary',
          font: 'inherit',
          fontSize: '0.875rem',
          fontWeight: 500,
          textAlign: 'left',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'surface.hover', color: 'text.primary' },
        }}
      >
        <Avatar
          src={user.image || undefined}
          alt=""
          aria-hidden
          sx={{
            width: 26,
            height: 26,
            borderRadius: '9px',
            bgcolor: 'tint.brand',
            color: 'primary.main',
            fontSize: '0.65625rem',
            fontWeight: 600,
          }}
        >
          {initials(name)}
        </Avatar>
        <Box
          component="span"
          sx={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {name}
        </Box>
      </Box>

      <Menu
        id="account-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ horizontal: 'left', vertical: 'top' }}
        transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { mb: 1, minWidth: 220 } } }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" fontWeight={500} color="text.primary">
            {user.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {user.email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem
          component={Link}
          href={SETTINGS_HREF}
          onClick={() => {
            setAnchorEl(null);
            onNavigate?.();
          }}
        >
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          Settings
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            void signOutToHome();
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Sign Out
        </MenuItem>
      </Menu>
    </>
  );
}
