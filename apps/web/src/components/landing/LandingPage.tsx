'use client';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import GoogleIcon from '@mui/icons-material/Google';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import TollOutlinedIcon from '@mui/icons-material/TollOutlined';
import BrandLogo from '@/components/layout/BrandLogo';
import BrandMark from '@/components/layout/BrandMark';
import { PRODUCT_NAME } from '@/lib/product';
import { signInWithGoogle } from '@/lib/auth-client';

const features = [
  {
    Icon: GroupsOutlinedIcon,
    title: 'Trips & Groups',
    description: 'Create a trip, invite friends with a link, and start splitting in minutes.',
  },
  {
    Icon: PieChartOutlineIcon,
    title: 'Smart Split',
    description: 'Equal, percentage, shares, or exact — split any way you want.',
  },
  {
    Icon: SwapHorizIcon,
    title: 'Settle Up',
    description:
      'See who pays whom with minimal transactions, and record settlements either side can confirm.',
  },
  {
    Icon: DashboardOutlinedIcon,
    title: 'Money-first Dashboard',
    description:
      'Your balance by currency, the next best action, and recent trip activity at a glance.',
  },
  {
    Icon: HistoryOutlinedIcon,
    title: 'Activity Audit Trail',
    description:
      'Every expense edit and settlement is logged, so the group can always see what changed.',
  },
  {
    Icon: TollOutlinedIcon,
    title: 'One Currency per Trip',
    description:
      'Each trip keeps a single currency, and balances never mix currencies into one number.',
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
          <BrandLogo height={32} href="/" />
          <Button
            variant="outlined"
            size="small"
            onClick={() => void signInWithGoogle('/dashboard')}
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
            onClick={() => void signInWithGoogle('/dashboard')}
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
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: 3 },
              }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '12px',
                  bgcolor: 'tint.brand',
                  color: 'primary.main',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2,
                }}
              >
                <feature.Icon />
              </Box>
              <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
                {feature.title}
              </Typography>
              <Typography color="text.secondary">{feature.description}</Typography>
            </Paper>
          ))}
        </Box>
      </Container>

      {/* Footer */}
      <Box
        component="footer"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.25,
          px: 2,
          py: 4,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <BrandMark size={24} />
        <Typography variant="body2" color="text.secondary">
          {PRODUCT_NAME} — shared expenses, settled fairly.
        </Typography>
      </Box>
    </Box>
  );
}
