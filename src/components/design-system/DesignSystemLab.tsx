'use client';

import { useState } from 'react';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Skeleton from '@mui/material/Skeleton';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import StatusLabel from '@/components/common/StatusLabel';
import ErrorState from '@/components/common/ErrorState';
import EmptyState from '@/components/common/EmptyState';
import MoneyText from '@/components/common/MoneyText';
import { useThemeMode } from '@/providers/ThemeProvider';
import { getSemanticTokens, RADIUS } from '@/lib/theme/tokens';

export default function DesignSystemLab() {
  const [recovered, setRecovered] = useState(false);
  const { mode, toggleTheme } = useThemeMode();
  const tokens = getSemanticTokens(mode);
  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          Splitbook design system
        </Typography>
        <Typography color="text.secondary">
          Local examples · synthetic data · no account or database
        </Typography>
        <Box>
          <Button variant="outlined" startIcon={<DarkModeIcon />} onClick={toggleTheme}>
            Switch to {mode === 'light' ? 'dark' : 'light'} mode
          </Button>
        </Box>
        <Typography component="h2" variant="h6">
          Semantic status pairs
        </Typography>
        <Typography color="text.secondary">
          Use status foregrounds on tints or normal surfaces. Always explain the meaning in words.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <StatusLabel tone="negative" label="You owe" />
          <StatusLabel tone="positive" label="Settled" />
          <StatusLabel tone="info" label="Information" />
          <StatusLabel tone="warning" label="Needs attention" />
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {Object.entries(tokens.status).map(([tone, color]) => (
            <Paper key={tone} variant="outlined" sx={{ p: 2 }}>
              <Typography component="h3" variant="subtitle2">
                {tone}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Foreground {color} · tint {tokens[tone as keyof typeof tokens.status].bg}
              </Typography>
            </Paper>
          ))}
        </Box>
        <Paper
          component="section"
          aria-labelledby="money-heading"
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 } }}
        >
          <Stack spacing={2}>
            <Typography id="money-heading" variant="h6" component="h2">
              Money and typography
            </Typography>
            <Typography color="text.secondary">
              Outfit for UI. IBM Plex Mono and tabular digits for money. Currency formatting remains
              unchanged.
            </Typography>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
            >
              <MoneyText amount={1480} currency="INR" tone="negative" variant="h5" />
              <MoneyText amount={0} currency="INR" tone="neutral" variant="h5" />
              <MoneyText amount={-275.5} currency="USD" signed variant="body1" />
              <MoneyText amount={1234567.89} currency="EUR" tone="positive" variant="body1" />
            </Box>
            <Typography variant="body2">
              A very long member name and an expense description should wrap without hiding the
              amount or action.
            </Typography>
          </Stack>
        </Paper>
        <Paper
          component="section"
          aria-labelledby="feedback-heading"
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 } }}
        >
          <Stack spacing={2}>
            <Typography id="feedback-heading" variant="h6" component="h2">
              Feedback states
            </Typography>
            {recovered ? (
              <Typography role="status">Sample balances loaded.</Typography>
            ) : (
              <ErrorState
                message="Sample balances could not be loaded."
                retryLabel="Retry sample"
                onRetry={() => setRecovered(true)}
              />
            )}
          </Stack>
        </Paper>
        <Paper
          component="section"
          aria-labelledby="controls-heading"
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 } }}
        >
          <Stack spacing={2}>
            <Typography id="controls-heading" variant="h6" component="h2">
              Controls and focus
            </Typography>
            <TextField
              label="Sample expense name"
              helperText="Local example only; nothing is saved."
            />
            <TextField
              label="Amount with an error"
              defaultValue="-1"
              error
              helperText="Enter a positive amount."
            />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={() => setRecovered(false)}>
                Reset feedback example
              </Button>
              <Button variant="outlined" disabled>
                Unavailable action
              </Button>
              <IconButton
                aria-label={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode using icon`}
                onClick={toggleTheme}
              >
                <DarkModeIcon />
              </IconButton>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Use Tab to inspect focus. Buttons keep their existing touch sizing. Motion follows
              your system preference.
            </Typography>
          </Stack>
        </Paper>
        <Paper
          component="section"
          aria-labelledby="empty-heading"
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 } }}
        >
          <Typography id="empty-heading" variant="h6" component="h2">
            Empty and loading states
          </Typography>
          <EmptyState
            title="No sample expenses yet"
            description="An empty result is different from an error or a request still loading."
          />
          <Stack role="status" aria-label="Loading sample expenses" aria-busy="true" spacing={1}>
            <Skeleton variant="rounded" height={64} />
            <Skeleton variant="rounded" height={64} />
          </Stack>
        </Paper>
        <Paper
          component="section"
          aria-labelledby="layout-heading"
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 } }}
        >
          <Stack spacing={2}>
            <Typography id="layout-heading" variant="h6" component="h2">
              Spacing, shape and composition
            </Typography>
            <Typography color="text.secondary">
              MUI spacing: 8px units. Page padding 2–3 units; section gaps 3–4. Breakpoints: 600 /
              900 / 1200 / 1536px. Radii: {RADIUS.sm} / {RADIUS.md} / {RADIUS.lg}px.
            </Typography>
            <Typography variant="body2">
              Use MUI defaults for controls, shared modules for repeated meaning, and sx for local
              layout. This page imports the runtime theme directly; prototype CSS is historical
              reference.
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
