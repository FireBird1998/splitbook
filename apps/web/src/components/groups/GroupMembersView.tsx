'use client';

import Link from 'next/link';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import { initials } from '@/components/layout/AccountMenu';
import { memberRoster, type GroupPerson, type GroupRole } from './group-tabs';

/** Sizes from the design canvas (web.css: .card, .card-h, .lrow, .avatar.lg, .badge). */
const CARD_RADIUS = '16px';
const AVATAR_SIZE = 40;
const AVATAR_RADIUS = '13px';

interface GroupMembersViewProps {
  members: Array<{ user: GroupPerson; role: GroupRole }>;
  /** The signed-in member, marked "(you)". */
  userId: string;
  settingsHref: string;
  onInvite: () => void;
}

/**
 * The Members tab (#305): a read-only roster of everyone in the Group with their role, and
 * Invite. It shows names only, never another member's email. Changing roles, removing members
 * and leaving stay in Group settings, which admins are pointed to.
 */
export default function GroupMembersView({
  members,
  userId,
  settingsHref,
  onInvite,
}: GroupMembersViewProps) {
  const rows = memberRoster(members, userId);
  const isAdmin = rows.some((row) => row.isViewer && row.role === 'admin');

  return (
    <Box
      component="section"
      aria-labelledby="group-members-heading"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: CARD_RADIUS,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px 12px',
          minHeight: 56,
          px: 2.5,
          pt: 2,
          pb: 1,
        }}
      >
        <Typography
          component="h2"
          id="group-members-heading"
          sx={{ m: 0, fontSize: '1rem', lineHeight: 1.3, fontWeight: 600, color: 'text.primary' }}
        >
          Members
          <Box
            component="span"
            sx={{ ml: 1, fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }}
          >
            {rows.length}
          </Box>
        </Typography>
        <Button
          variant="outlined"
          startIcon={<PersonAddAltOutlinedIcon sx={{ fontSize: 18 }} />}
          onClick={onInvite}
          sx={{
            minHeight: 44,
            px: 2,
            borderRadius: '12px',
            borderColor: 'border.strong',
            bgcolor: 'background.paper',
            color: 'text.primary',
            fontWeight: 600,
            '&:hover': { bgcolor: 'surface.hover', borderColor: 'border.strong' },
          }}
        >
          Invite
        </Button>
      </Box>

      <Box component="ul" aria-label="Members" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rows.map((row) => (
          <Box
            component="li"
            key={row.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              minHeight: 60,
              px: 2.5,
              py: 1,
              '& + li': { borderTop: 1, borderColor: 'divider' },
            }}
          >
            <Avatar
              src={row.image}
              alt=""
              aria-hidden
              sx={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_RADIUS,
                bgcolor: 'tint.brand',
                color: 'primary.main',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}
            >
              {initials(row.name)}
            </Avatar>
            <Typography
              sx={{
                flex: '1 1 auto',
                minWidth: 0,
                m: 0,
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'text.primary',
                overflowWrap: 'anywhere',
              }}
            >
              {row.name}
              {row.isViewer ? (
                <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                  {' '}
                  (you)
                </Box>
              ) : null}
            </Typography>
            <Box
              component="span"
              sx={{
                flex: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                px: '9px',
                py: '2px',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                ...(row.role === 'admin'
                  ? { bgcolor: 'tint.brand', color: 'primary.main' }
                  : { bgcolor: 'surface.muted', color: 'text.secondary' }),
              }}
            >
              {row.roleLabel}
            </Box>
          </Box>
        ))}
      </Box>

      {isAdmin ? (
        <Box sx={{ px: 2.5, py: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ m: 0, color: 'text.secondary' }}>
            Change roles, remove members or leave the Group in{' '}
            <Box
              component={Link}
              href={settingsHref}
              sx={{ color: 'primary.main', fontWeight: 600, textUnderlineOffset: '2px' }}
            >
              Group settings
            </Box>
            .
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}
