'use client';

import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

interface DemoModeBadgeProps {
  compact?: boolean;
}

/** Persistent, unobtrusive marker shown whenever AUTH_MODE resolves to demo. */
export default function DemoModeBadge({ compact = false }: DemoModeBadgeProps) {
  return (
    <Tooltip title="Shared demo environment — data is seeded for private beta testing">
      <Chip
        label={compact ? 'Demo' : 'Demo mode'}
        size="small"
        color="info"
        variant="outlined"
        sx={{
          height: 24,
          fontWeight: 600,
          fontSize: '0.7rem',
          borderColor: 'info.main',
        }}
      />
    </Tooltip>
  );
}
