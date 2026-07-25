'use client';

import { signIn } from 'next-auth/react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import GoogleIcon from '@mui/icons-material/Google';
import { getSignInProvider } from '@/lib/auth-sign-in';

const SIGN_IN_PROVIDER = getSignInProvider('google');

const features = [
  {
    icon: '👥',
    title: 'Groups',
    description: 'Create groups for trips, home, work, or anything else.',
  },
  {
    icon: '💸',
    title: 'Smart Split',
    description: 'Equal, percentage, shares, or exact — split any way you want.',
  },
  {
    icon: '💰',
    title: 'Settle Up',
    description: 'Minimize transactions with smart debt simplification.',
  },
  {
    icon: '📊',
    title: 'Dashboard',
    description: 'Filter and search expenses by date, tags, categories, and more.',
  },
  {
    icon: '🔄',
    title: 'Real-time Sync',
    description: 'Instant updates when anyone adds or edits an expense.',
  },
  {
    icon: '💱',
    title: 'Multi-Currency',
    description: 'Set default + 2 alternate currencies per group for easy selection.',
  },
];

export default function LandingPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: (theme) =>
          `linear-gradient(to bottom, ${theme.palette.background.paper}, ${theme.palette.background.default})`,
      }}
    >
      {/* Navbar */}
      <Container maxWidth="lg">
        <Stack
          component="nav"
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ py: 2 }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography component="span" sx={{ fontSize: '1.5rem' }}>
              💰
            </Typography>
            <Typography
              component="span"
              sx={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: 'text.primary',
              }}
            >
              SplitWise
            </Typography>
          </Stack>
          <Button
            variant="outlined"
            size="small"
            onClick={() => signIn(SIGN_IN_PROVIDER, { callbackUrl: '/dashboard' })}
            sx={{ borderColor: 'primary.main', color: 'primary.main' }}
          >
            Sign In
          </Button>
        </Stack>
      </Container>

      {/* Hero */}
      <Container maxWidth="md">
        <Box sx={{ textAlign: 'center', py: 10 }}>
          <Typography
            variant="h2"
            fontWeight={700}
            color="text.primary"
            sx={{
              mb: 3,
              lineHeight: 1.2,
              fontSize: { xs: '2.5rem', md: '3rem' },
            }}
          >
            Split expenses with friends,{' '}
            <Typography component="span" variant="inherit" color="primary.main">
              the smart way.
            </Typography>
          </Typography>
          <Typography
            variant="h6"
            color="text.secondary"
            sx={{ mb: 5, maxWidth: 640, mx: 'auto', fontWeight: 400 }}
          >
            Track group expenses, settle debts with minimal transactions, and never argue about
            money again.
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<GoogleIcon />}
            onClick={() => signIn(SIGN_IN_PROVIDER, { callbackUrl: '/dashboard' })}
            sx={{
              fontSize: '1.1rem',
              py: 1.5,
              px: 4,
            }}
          >
            Sign in with Google
          </Button>
        </Box>
      </Container>

      {/* Features Grid */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: '1fr 1fr',
              lg: '1fr 1fr 1fr',
            },
            gap: 4,
          }}
        >
          {features.map((feature) => (
            <Paper
              key={feature.title}
              variant="outlined"
              sx={{
                p: 4,
                borderRadius: 4,
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: 3 },
              }}
            >
              <Typography component="span" sx={{ fontSize: '2.5rem', display: 'block', mb: 2 }}>
                {feature.icon}
              </Typography>
              <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
                {feature.title}
              </Typography>
              <Typography color="text.secondary">{feature.description}</Typography>
            </Paper>
          ))}
        </Box>
      </Container>

      {/* Footer */}
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Built with ❤️ · SplitWise Clone
        </Typography>
      </Box>
    </Box>
  );
}
