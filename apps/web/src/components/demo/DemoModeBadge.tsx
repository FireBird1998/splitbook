'use client';

import Box from '@mui/material/Box';
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
        icon={
          <Box
            component="span"
            sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main' }}
          />
        }
        sx={{
          height: 24,
          fontWeight: 600,
          fontSize: '0.7rem',
          bgcolor: 'tint.warning',
          color: 'status.warning',
          '& .MuiChip-icon': { ml: 1 },
        }}
      />
    </Tooltip>
  );
}
