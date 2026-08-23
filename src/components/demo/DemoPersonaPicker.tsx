'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { DEMO_PERSONAS, type DemoPersonaKey } from '@/lib/demo-personas';
import DemoModeBadge from '@/components/demo/DemoModeBadge';
import BrandMark from '@/components/layout/BrandMark';

interface DemoPersonaPickerProps {
  callbackUrl?: string;
  title?: string;
  subtitle?: string;
}

const PERSONA_TINTS: Record<DemoPersonaKey, { bg: string; fg: string }> = {
  alex: { bg: 'tint.brand', fg: 'primary.main' },
  sam: { bg: 'tint.info', fg: 'info.main' },
  priya: { bg: 'tint.positive', fg: 'success.main' },
};

/**
 * Persona entry for the private beta — the first screen testers see.
 * Visual language mirrors docs/design/private-beta/01-persona-entry.html.
 */
export default function DemoPersonaPicker({
  callbackUrl = '/dashboard',
  title = 'Enter as a persona',
  subtitle = 'Shared demo trip for private-beta testers. Pick who you are — balances update for that person.',
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
        display: 'grid',
        placeItems: 'center',
        px: 2,
        py: 6,
        background: (theme) =>
          `radial-gradient(ellipse 80% 50% at 50% -10%, ${theme.palette.primary.main}24, transparent), ${theme.palette.background.default}`,
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 920,
          animation: 'panel-in 280ms ease-out both',
        }}
      >
        <Stack alignItems="center" spacing={1.5} sx={{ textAlign: 'center', mb: 6 }}>
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <BrandMark size={40} fontSize={18} />
            <Typography
              component="span"
              sx={{
                fontSize: '1.75rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'text.primary',
              }}
            >
              Splitbook
            </Typography>
          </Stack>
          <DemoModeBadge />
          <Typography
            variant="h4"
            component="h1"
            fontWeight={700}
            color="text.primary"
            sx={{ letterSpacing: '-0.02em', mt: 2 }}
          >
            {title}
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: '36ch' }}>
            {subtitle}
          </Typography>
        </Stack>

        {error && (
          <Typography color="error.main" variant="body2" sx={{ textAlign: 'center', mb: 2 }}>
            {error}
          </Typography>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: 2,
          }}
        >
          {DEMO_PERSONAS.map((persona) => {
            const busy = loadingKey === persona.key;
            const tint = PERSONA_TINTS[persona.key];
            return (
              <Box
                key={persona.key}
                component="button"
                type="button"
                disabled={loadingKey !== null}
                onClick={() => handleSelect(persona.key)}
                aria-label={`Enter as ${persona.name}, ${persona.role}. ${persona.headline}`}
                sx={{
                  textAlign: 'left',
                  p: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '16px',
                  bgcolor: 'background.paper',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  width: '100%',
                  font: 'inherit',
                  color: 'inherit',
                  transition:
                    'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                  '&:hover': {
                    borderColor: 'primary.main',
                    boxShadow: 2,
                    transform: 'translateY(-2px)',
                  },
                  '&:focus-visible': { borderColor: 'focus.main' },
                  '&:disabled': { opacity: 0.7, cursor: 'default' },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Box
                    component="span"
                    aria-hidden="true"
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: '14px',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: '1.125rem',
                      bgcolor: tint.bg,
                      color: tint.fg,
                    }}
                  >
                    {persona.name[0]}
                  </Box>
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700} color="text.primary">
                      {persona.name}
                    </Typography>
                    <Chip
                      label={persona.role === 'organizer' ? 'Organizer' : 'Member'}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        bgcolor: tint.bg,
                        color: tint.fg,
                      }}
                    />
                  </Box>
                  {busy && <CircularProgress size={18} sx={{ ml: 'auto' }} />}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {persona.headline}
                </Typography>
              </Box>
            );
          })}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
          Shared demo data — sign out and pick another persona to switch views. Currencies stay
          separate, never combined into one number.
        </Typography>
      </Box>
    </Box>
  );
}
