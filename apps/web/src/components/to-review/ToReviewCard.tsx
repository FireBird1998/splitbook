'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { toReviewHref } from '@splitbook/shared/api-paths';
import {
  HomeCard,
  HomeCardBody,
  HomeCardError,
  HomeCardLoading,
  HomeList,
  homeRowSx,
} from '@/components/dashboard/HomeCard';
import { toReviewEnabled, useToReview } from './use-to-review';

export default function ToReviewCard() {
  const { read, retry } = useToReview();
  if (!toReviewEnabled || (read.status === 'ready' && read.value.counts.total === 0)) return null;
  return (
    <HomeCard
      id="to-review"
      title={read.status === 'ready' ? `To review · ${read.value.counts.total}` : 'To review'}
    >
      {read.status === 'loading' && (
        <HomeCardLoading label="Loading To review" blocks={1} height={60} />
      )}
      {read.status === 'error' && (
        <HomeCardError message="Unable to load To review." onRetry={retry} />
      )}
      {read.status === 'ready' && (
        <>
          <HomeList label="Groups with items to review">
            {read.value.groups.map((group) => (
              <Box component="li" key={group.groupId}>
                <Box
                  component={Link}
                  href={toReviewHref(group.groupId)}
                  sx={{
                    ...homeRowSx,
                    color: 'text.primary',
                    textDecoration: 'none',
                    overflowWrap: 'anywhere',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight={600}>{group.groupName}</Typography>
                    {group.sourceSummary && (
                      <Typography variant="body2" color="text.secondary">
                        {group.sourceSummary}
                      </Typography>
                    )}
                  </Box>
                  <Typography aria-label={`${group.counts.total} to review`}>
                    {group.counts.total}
                  </Typography>
                </Box>
              </Box>
            ))}
          </HomeList>
          <HomeCardBody>
            <Typography variant="caption" color="text.secondary">
              Only you see these
            </Typography>
          </HomeCardBody>
        </>
      )}
    </HomeCard>
  );
}
