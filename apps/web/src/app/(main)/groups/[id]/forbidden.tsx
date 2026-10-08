'use client';

import Link from 'next/link';
import Button from '@mui/material/Button';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import GroupUnavailable from '@/components/groups/GroupUnavailable';
import { HOME_HREF } from '@/components/layout/shell-nav';

/**
 * A Group's server page that the member may not open (`forbidden()`, a real HTTP 403 through
 * `experimental.authInterrupts`): the statement (#319) for a Group they never joined, have
 * left, or that doesn't exist. It shows inside the app's shell, in the Group page's own words
 * for a Group the member can't open (#201), with the way back Home. It takes no props, so it
 * can't name the Group or say whether it exists.
 */
export default function GroupForbidden() {
  return (
    <GroupUnavailable
      headingComponent="h1"
      action={
        <Button
          component={Link}
          href={HOME_HREF}
          variant="contained"
          startIcon={<HomeOutlinedIcon />}
        >
          Back to Home
        </Button>
      }
    />
  );
}
