'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { toReviewHref } from '@splitbook/shared/api-paths';
import { RADIUS } from '@/lib/theme/tokens';
import { toReviewEnabled, useToReview } from './use-to-review';

export default function ToReviewBanner({ groupId }: { groupId: string }) {
  const { read, retry } = useToReview();
  const group =
    read.status === 'ready'
      ? read.value.groups.find((group) => group.groupId === groupId)
      : undefined;
  if (!toReviewEnabled || read.status === 'loading' || (read.status === 'ready' && !group))
    return null;
  return (
    <Box
      component="section"
      aria-label="To review"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.md}px`,
        bgcolor: 'tint.info',
      }}
    >
      {read.status === 'error' && (
        <>
          <Typography role="status">Unable to load To review.</Typography>
          <Button onClick={retry}>Try again</Button>
        </>
      )}
      {group && (
        <>
          <Typography sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>
            {[`${group.counts.total} to review`, group.bannerSummary].filter(Boolean).join(' · ')}
          </Typography>
          <Button
            component={Link}
            href={toReviewHref(groupId)}
            variant="outlined"
            color="inherit"
            size="small"
          >
            Review
          </Button>
        </>
      )}
    </Box>
  );
}
