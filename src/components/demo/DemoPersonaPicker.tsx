'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { DEMO_PERSONAS, type DemoPersonaKey } from '@/lib/demo-personas';
import DemoModeBadge from '@/components/demo/DemoModeBadge';

interface DemoPersonaPickerProps {
  callbackUrl?: string;
  title?: string;
  subtitle?: string;
}

/**
 * Minimal functional persona entry for private beta.
 * Phase 5 owns the final visual design.
 */
export default function DemoPersonaPicker({
  callbackUrl = '/dashboard',
  title = 'Try the private beta',
  subtitle = 'Pick a persona to enter the seeded Goa friends trip.',
}: DemoPersonaPickerProps) {
  const [loadingKey, setLoadingKey] = useState<DemoPersonaKey | null>(null);
  const [error, setError] = useState('');

  const handleSelect = async (personaKey: DemoPersonaKey) => {
    setLoadingKey(personaKey);
    setError('');
    try {
      await signIn('demo', {
        personaId: personaKey,
        callbackUrl,
      });
    } catch {
      setError('Something went wrong signing in.');
      setLoadingKey(null);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 2,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: '100%',
          maxWidth: 420,
          p: { xs: 3, sm: 4 },
          borderRadius: 3,
        }}
      >
        <Stack spacing={3}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography component="span" sx={{ fontSize: '1.75rem' }}>
                💰
              </Typography>
              <Typography variant="h6" fontWeight={700} color="text.primary">
                SplitWise
              </Typography>
            </Stack>
            <DemoModeBadge />
          </Stack>

          <Box>
            <Typography variant="h5" fontWeight={700} color="text.primary" sx={{ mb: 1 }}>
              {title}
            </Typography>
            <Typography color="text.secondary">{subtitle}</Typography>
          </Box>

          {error && (
            <Typography color="error.main" variant="body2">
              {error}
            </Typography>
          )}

          <Stack spacing={1.5}>
            {DEMO_PERSONAS.map((persona) => {
              const busy = loadingKey === persona.key;
              return (
                <Button
                  key={persona.key}
                  variant="outlined"
                  fullWidth
                  disabled={loadingKey !== null}
                  onClick={() => handleSelect(persona.key)}
                  sx={{
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    py: 1.5,
                    px: 2,
                    borderColor: 'divider',
                    color: 'text.primary',
                  }}
                >
                  <Stack spacing={0.25} sx={{ width: '100%' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={600}>{persona.name}</Typography>
                      {busy ? <CircularProgress size={16} /> : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {persona.headline}
                    </Typography>
                  </Stack>
                </Button>
              );
            })}
          </Stack>

          <Typography variant="caption" color="text.disabled">
            Shared demo data. Sign out and pick another persona to switch views.
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
