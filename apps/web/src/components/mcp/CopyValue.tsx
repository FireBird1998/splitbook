'use client';

import { useState } from 'react';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/** A value to paste into an assistant, shown in full and copied by a button that says so. */
export default function CopyValue({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback('Copied.');
    } catch {
      setFeedback('Copy unavailable. Select the text above and copy it manually.');
    }
  }
  return (
    <Stack spacing={1}>
      <Typography
        component="p"
        sx={{
          overflowWrap: 'anywhere',
          userSelect: 'all',
          bgcolor: 'action.hover',
          p: 2,
          borderRadius: 1,
        }}
      >
        {value}
      </Typography>
      <Button variant="outlined" onClick={() => void copy()} sx={{ alignSelf: 'flex-start' }}>
        Copy {label}
      </Button>
      <Typography role="status" variant="body2">
        {feedback}
      </Typography>
    </Stack>
  );
}
