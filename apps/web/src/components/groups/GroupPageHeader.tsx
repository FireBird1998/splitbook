'use client';

import { createElement } from 'react';
import Link from 'next/link';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { GroupCategory } from '@splitbook/shared/types';
import { groupThemeIcon } from '@/components/layout/group-theme-icons';
import { initials } from '@/components/layout/AccountMenu';
import { groupSummaryLine, membersLabel, viewerFirst, type GroupPerson } from './group-tabs';

/** Header sizes from the design canvas (GroupExpenses: .page-h, .gx-gi, .avatar, .btn). */
const TILE_SIZE = 52;
const TILE_RADIUS = '15px';
const AVATAR_SIZE = 32;
const AVATAR_RADIUS = '11px';
const CONTROL_RADIUS = '12px';
/** Avatars shown before the rest are counted as "+N". */
const MAX_AVATARS = 5;

interface GroupPageHeaderProps {
  name: string;
  category: GroupCategory;
  /** The Theme's display name, e.g. "Household". */
  themeLabel: string;
  currency: string;
  members: GroupPerson[];
  /** The signed-in member, counted as "you". */
  userId: string;
  settingsHref: string;
  onInvite: () => void;
  onAddExpense: () => void;
}

/**
 * The top of a Group's page (#305, design canvas "Web portal"): the Theme's line icon, the
 * Group's name, "Theme · N members · currency", the members' avatars, Invite and settings.
 * The shell's sidebar does the navigating, so there is no back link.
 */
export default function GroupPageHeader({
  name,
  category,
  themeLabel,
  currency,
  members,
  userId,
  settingsHref,
  onInvite,
  onAddExpense,
}: GroupPageHeaderProps) {
  const people = viewerFirst(
    members.map((member) => ({ user: member })),
    userId,
  ).map(({ user }) => user);
  const shown = people.slice(0, people.length > MAX_AVATARS ? MAX_AVATARS - 1 : MAX_AVATARS);
  const more = people.length - shown.length;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '12px 20px',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        <Box
          aria-hidden
          data-group-theme={category}
          sx={{
            width: TILE_SIZE,
            height: TILE_SIZE,
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: TILE_RADIUS,
            bgcolor: 'tint.brand',
            color: 'primary.main',
          }}
        >
          {createElement(groupThemeIcon(category), { sx: { fontSize: 24 } })}
        </Box>
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography
            component="h1"
            sx={{
              m: 0,
              fontSize: '1.75rem',
              lineHeight: 1.15,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'text.primary',
              overflowWrap: 'anywhere',
            }}
          >
            {name}
          </Typography>
          <Typography sx={{ m: 0, fontSize: '0.875rem', lineHeight: 1.4, color: 'text.secondary' }}>
            {groupSummaryLine(themeLabel, members.length, currency)}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        {people.length > 0 ? (
          <Box
            role="img"
            aria-label={membersLabel(people, userId)}
            sx={{ display: 'inline-flex', mr: 1 }}
          >
            {shown.map((person) => (
              <Avatar
                key={person._id}
                src={person.image ?? undefined}
                alt=""
                aria-hidden
                sx={avatarSx}
              >
                {initials(person.name)}
              </Avatar>
            ))}
            {more > 0 ? (
              <Avatar aria-hidden sx={avatarSx}>
                +{more}
              </Avatar>
            ) : null}
          </Box>
        ) : null}
        <Button
          variant="outlined"
          startIcon={<PersonAddAltOutlinedIcon sx={{ fontSize: 18 }} />}
          onClick={onInvite}
          sx={{
            minHeight: 44,
            px: 2,
            borderRadius: CONTROL_RADIUS,
            borderColor: 'border.strong',
            bgcolor: 'background.paper',
            color: 'text.primary',
            fontWeight: 600,
            '&:hover': { bgcolor: 'surface.hover', borderColor: 'border.strong' },
          }}
        >
          Invite
        </Button>
        <IconButton
          component={Link}
          href={settingsHref}
          aria-label={`${name} settings`}
          sx={{
            width: 44,
            height: 44,
            flex: 'none',
            borderRadius: CONTROL_RADIUS,
            color: 'text.secondary',
            '&:hover': { bgcolor: 'surface.muted', color: 'text.primary' },
          }}
        >
          <SettingsOutlinedIcon />
        </IconButton>
        {/* Until the top bar's Add expense arrives (#304); phones use the bar at the foot. */}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onAddExpense}
          sx={{
            display: { xs: 'none', sm: 'inline-flex' },
            minHeight: 44,
            px: 2,
            borderRadius: CONTROL_RADIUS,
            fontWeight: 600,
          }}
        >
          Add expense
        </Button>
      </Box>
    </Box>
  );
}

const avatarSx = {
  width: AVATAR_SIZE,
  height: AVATAR_SIZE,
  borderRadius: AVATAR_RADIUS,
  bgcolor: 'tint.brand',
  color: 'primary.main',
  fontSize: '0.75rem',
  fontWeight: 600,
  // A ring in the page's surface colour separates the overlapping avatars.
  boxShadow: (theme: Theme) => `0 0 0 2px ${theme.palette.background.paper}`,
  '&:not(:first-of-type)': { ml: '-6px' },
} as const;
