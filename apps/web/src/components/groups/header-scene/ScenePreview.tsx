'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import type { GroupHeader } from '@splitbook/shared/group-header';
import { useSceneArt } from './use-scene-art';
import ScenePicture from './ScenePicture';

/** A live art-only preview; thumbnails share the same loader and portable renderer. */
export default function ScenePreview({
  scene,
  time,
  motion,
  followPointer,
  thumbnail = false,
}: {
  scene: GroupHeader['scene'];
  time: Exclude<GroupHeader['time'], 'auto'>;
  motion: boolean;
  followPointer: boolean;
  thumbnail?: boolean;
}) {
  const { picture: value, failed, retry } = useSceneArt(scene);
  return (
    <Box
      data-scene-preview={thumbnail ? 'thumbnail' : 'live'}
      sx={{
        position: 'relative',
        height: thumbnail ? 60 : 232,
        overflow: 'hidden',
        borderRadius: thumbnail ? '8px' : '14px',
        border: thumbnail ? 0 : '1px solid',
        borderColor: 'divider',
        bgcolor: 'surface.muted',
      }}
    >
      {value ? (
        <>
          <style>{value.css}</style>
          <ScenePicture
            art={value.art}
            time={time}
            motion={motion}
            followPointer={followPointer}
            cropped
          />
        </>
      ) : failed ? (
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            p: thumbnail ? 0.25 : 1,
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: thumbnail ? 10 : 12, overflowWrap: 'anywhere' }}
          >
            Preview unavailable
          </Typography>
          {!thumbnail && <Button onClick={retry}>Try again</Button>}
        </Box>
      ) : (
        <Skeleton variant="rectangular" width="100%" height="100%" animation={false} />
      )}
    </Box>
  );
}
