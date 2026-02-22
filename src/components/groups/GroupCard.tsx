'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';

const CATEGORY_ICONS: Record<string, string> = {
  trip: '✈️',
  home: '🏠',
  couple: '💑',
  work: '💼',
  other: '📋',
};

interface GroupCardProps {
  group: Record<string, unknown>;
  userId: string;
}

export default function GroupCard({ group, userId }: GroupCardProps) {
  const members = (group.members || []) as Array<{
    user: { _id: string; name: string; image?: string };
    role: string;
  }>;
  const category = group.category as string;
  const icon = CATEGORY_ICONS[category] || '📋';

  return (
    <Paper
      component={Link}
      href={`/groups/${group._id}`}
      variant="outlined"
      sx={{
        display: 'block',
        p: 3,
        textDecoration: 'none',
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: 3 },
      }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography component="span" sx={{ fontSize: '1.5rem' }}>
            {icon}
          </Typography>
          <Box>
            <Typography variant="body2" fontWeight={600} color="text.primary">
              {group.name as string}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'capitalize' }}
            >
              {category}
            </Typography>
          </Box>
        </Stack>
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2 }}>
        <AvatarGroup max={4} sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 12 } }}>
          {members.map((m) => (
            <Avatar
              key={m.user._id}
              src={m.user.image}
              alt={m.user.name}
              sx={{ width: 28, height: 28 }}
            >
              {m.user.name?.[0]}
            </Avatar>
          ))}
        </AvatarGroup>
        <Typography variant="caption" color="text.secondary">
          {members.length} member{members.length !== 1 ? 's' : ''}
        </Typography>
      </Stack>
    </Paper>
  );
}
