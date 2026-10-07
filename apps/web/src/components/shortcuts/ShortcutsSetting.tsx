'use client';

import { useId } from 'react';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useShortcutSetting } from '@/lib/shortcuts/ShortcutsProvider';

/**
 * Settings' Keyboard shortcuts section (#322): the switch that turns single-key shortcuts off,
 * as WCAG 2.1.4 asks, so they never clash with a screen reader or voice control. It holds for
 * the signed-in member on this device; ⌘K search keeps working either way.
 */
export default function ShortcutsSetting() {
  const { singleKeys, setSingleKeys } = useShortcutSetting();
  const descriptionId = useId();
  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600} color="text.primary">
          Keyboard shortcuts
        </Typography>
        <FormControlLabel
          control={
            <Switch
              // On until this device's setting is read, which happens as the page loads.
              checked={singleKeys ?? true}
              disabled={singleKeys === null}
              onChange={(event) => setSingleKeys(event.target.checked)}
              // MUI's own `role="switch"` goes when the input's props are given, so it is kept.
              slotProps={{ input: { role: 'switch', 'aria-describedby': descriptionId } }}
            />
          }
          label="Single-key shortcuts"
          sx={{ alignSelf: 'flex-start' }}
        />
        <Typography id={descriptionId} variant="body2" color="text.secondary">
          N adds an Expense, / searches the Group, and J, K and E move through and edit the Expenses
          table. Turn them off if they get in the way of a screen reader or voice control. ⌘K
          (Ctrl+K) search keeps working. This applies to you on this device.
        </Typography>
      </Stack>
    </Paper>
  );
}
