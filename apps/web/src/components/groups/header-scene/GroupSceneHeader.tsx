'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { headerCard, headerTimeOfDay, type GroupHeader } from '@splitbook/shared/group-header';
import type { GroupRead } from '@splitbook/shared/group-read';
import HeaderSceneView from './HeaderSceneView';
import { useSceneArt } from './use-scene-art';
import { useHeaderClock } from './use-header-clock';
import { useScenePreferences } from './scene-preferences';

export default function GroupSceneHeader({
  group,
  header,
}: {
  group: GroupRead;
  header: GroupHeader;
}) {
  const clock = useHeaderClock();
  const { picture, failed, retry } = useSceneArt(header.scene);
  const preferences = useScenePreferences();
  return (
    <Box aria-busy={!picture && !failed}>
      {picture && <style>{picture.css}</style>}
      <HeaderSceneView
        card={headerCard(group, clock?.today ?? '')}
        art={picture?.art ?? null}
        time={headerTimeOfDay(header.time, clock?.hour ?? 12)}
        motion={preferences.motion}
        followPointer={preferences.followPointer}
      />
      {failed && (
        <Typography role="status" variant="body2" color="text.secondary">
          The Header scene could not be loaded. <Button onClick={retry}>Try again</Button>
        </Typography>
      )}
    </Box>
  );
}
