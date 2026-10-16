'use client';

import Image from 'next/image';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import GoogleIcon from '@mui/icons-material/Google';
import BrandLogo from '@/components/layout/BrandLogo';
import BrandMark from '@/components/layout/BrandMark';
import { PRODUCT_NAME } from '@/lib/product';
import { signInWithGoogle } from '@/lib/auth-client';
import type { WhatsLive } from '@/lib/landing/whats-live';

/** A section of the page the top bar links to, such as `{ href: '#groups', label: 'Groups' }`. */
export interface LandingSectionLink {
  href: string;
  label: string;
}

interface LandingPageProps {
  /** What this deployment has live: the page describes nothing else (#443). */
  live: WhatsLive;
}

/** Google's official badge (play.google.com/intl/en_us/badges), shown unmodified. */
const PLAY_BADGE = { src: '/badges/google-play-badge-en.png', width: 646, height: 250 };
/**
 * The badge's artwork has transparent margins: at 78 px tall its visible badge is 52 px tall,
 * with about 12 px clear on each side.
 */
const PLAY_BADGE_HEIGHT = 78;
const PLAY_BADGE_SIDE_MARGIN = 12;

const wrap = { px: { xs: 2, sm: 3 } } as const;

function SignInWithGoogle() {
  return (
    <Button
      variant="contained"
      size="large"
      startIcon={<GoogleIcon />}
      onClick={() => void signInWithGoogle('/dashboard')}
      sx={{ minHeight: 52, px: 3, fontSize: '1rem' }}
    >
      Sign in with Google
    </Button>
  );
}

function GetItOnGooglePlay({ href }: { href: string }) {
  return (
    <Box
      component="a"
      href={href}
      sx={{
        display: 'inline-flex',
        // The artwork's transparent margins sit outside the row, so the visible badge lines up
        // with the 52 px buttons beside and above it.
        my: `${-(PLAY_BADGE_HEIGHT - 52) / 2}px`,
        mx: `${-PLAY_BADGE_SIDE_MARGIN}px`,
        borderRadius: 1,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'focus.main' },
      }}
    >
      <Image
        src={PLAY_BADGE.src}
        alt="Get it on Google Play"
        width={PLAY_BADGE.width}
        height={PLAY_BADGE.height}
        unoptimized
        style={{
          display: 'block',
          height: PLAY_BADGE_HEIGHT,
          width: Math.round((PLAY_BADGE_HEIGHT * PLAY_BADGE.width) / PLAY_BADGE.height),
        }}
      />
    </Box>
  );
}

/** The logo, the page's section links (hidden below 900 px), Get the app and Sign in. */
export function LandingTopBar({
  live,
  sections = [],
}: {
  live: WhatsLive;
  sections?: LandingSectionLink[];
}) {
  return (
    <Box
      component="header"
      sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'surface.elevated' }}
    >
      <Container maxWidth="lg" sx={wrap}>
        <Box
          component="nav"
          aria-label={PRODUCT_NAME}
          sx={{
            minHeight: 68,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <BrandLogo height={32} href="/" />
          {sections.length > 0 && (
            <Stack direction="row" spacing={3.5} sx={{ display: { xs: 'none', md: 'flex' } }}>
              {sections.map((section) => (
                <Link
                  key={section.href}
                  href={section.href}
                  underline="hover"
                  color="text.secondary"
                  sx={{ fontWeight: 500 }}
                >
                  {section.label}
                </Link>
              ))}
            </Stack>
          )}
          <Stack direction="row" spacing={1.25} alignItems="center">
            {live.playStoreUrl && (
              <Link
                href={live.playStoreUrl}
                underline="hover"
                color="text.primary"
                sx={{ display: { xs: 'none', md: 'inline-flex' }, fontWeight: 600, px: 0.75 }}
              >
                Get the app
              </Link>
            )}
            <Button variant="contained" href="/login" sx={{ minHeight: 44 }}>
              Sign in
            </Button>
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}

function Hero({ live }: LandingPageProps) {
  return (
    <Box component="section" sx={{ py: { xs: 5, md: 10 } }}>
      <Container
        maxWidth="lg"
        sx={{
          ...wrap,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: { xs: 3, md: 7 },
        }}
      >
        <Stack spacing={2.5} alignItems="flex-start" sx={{ flex: '1.2 1 520px', minWidth: 0 }}>
          <Typography
            sx={{
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              bgcolor: 'tint.brand',
              color: 'primary.main',
              fontSize: '0.8125rem',
              fontWeight: 600,
            }}
          >
            {live.playStoreUrl ? 'Shared expenses · Android and web' : 'Shared expenses'}
          </Typography>
          <Typography
            component="h1"
            sx={{
              m: 0,
              fontSize: 'clamp(40px, 5.6vw, 72px)',
              lineHeight: 1.02,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              color: 'text.primary',
              textWrap: 'balance',
            }}
          >
            Every shared cost, worked out to the paisa.
          </Typography>
        </Stack>
        <Stack spacing={2.5} alignItems="flex-start" sx={{ flex: '1 1 380px', minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.1875rem', lineHeight: 1.55, color: 'text.secondary' }}>
            Trips, flats, couples and teams. Add what was paid, split it the way it happened, and{' '}
            {PRODUCT_NAME} shows who owes whom, then settles it in the fewest payments.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            <SignInWithGoogle />
            {live.playStoreUrl && <GetItOnGooglePlay href={live.playStoreUrl} />}
          </Box>
          {live.assistants.available && (
            <Link
              href="#assistants"
              underline="hover"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                color: 'status.info',
                fontWeight: 600,
              }}
            >
              Use Claude or ChatGPT? Connect {PRODUCT_NAME}
              <ArrowForwardIcon fontSize="small" aria-hidden />
            </Link>
          )}
        </Stack>
      </Container>
    </Box>
  );
}

function ClosingCallToAction({ live }: LandingPageProps) {
  return (
    <Box component="section" sx={{ py: { xs: 8, md: 15 } }}>
      <Container maxWidth="lg" sx={wrap}>
        <Stack spacing={2.75} alignItems="center" sx={{ textAlign: 'center' }}>
          <Typography
            component="h2"
            sx={{
              m: 0,
              maxWidth: 760,
              fontSize: 'clamp(32px, 4vw, 52px)',
              lineHeight: 1.08,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'text.primary',
              textWrap: 'balance',
            }}
          >
            Start your first Group tonight. Settle it by the weekend.
          </Typography>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 1.5,
            }}
          >
            <SignInWithGoogle />
            {live.playStoreUrl && <GetItOnGooglePlay href={live.playStoreUrl} />}
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}

function LandingFooter({ live }: LandingPageProps) {
  const links = [
    { label: 'Privacy', href: live.links.privacy },
    { label: 'Terms', href: live.links.terms },
    { label: 'Support', href: live.links.support },
  ].filter((link): link is { label: string; href: string } => link.href !== null);
  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'surface.elevated' }}
    >
      <Container
        maxWidth="lg"
        sx={{
          ...wrap,
          py: 2.5,
          minHeight: 88,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <BrandMark size={24} />
          <Typography variant="body2" color="text.secondary">
            {PRODUCT_NAME} · shared expenses, settled fairly.
          </Typography>
        </Stack>
        {links.length > 0 && (
          <Stack component="nav" aria-label="Footer" direction="row" spacing={2.75}>
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                underline="hover"
                color="text.secondary"
                variant="body2"
              >
                {link.label}
              </Link>
            ))}
          </Stack>
        )}
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} {PRODUCT_NAME}
        </Typography>
        {live.playStoreUrl && (
          <Typography variant="caption" color="text.secondary" sx={{ flexBasis: '100%' }}>
            Google Play and the Google Play logo are trademarks of Google LLC.
          </Typography>
        )}
      </Container>
    </Box>
  );
}

/**
 * The public landing page a signed-out visitor gets at `/` (#443): the top bar, the hero, the
 * closing call to action and the footer, each saying only what `live` says this deployment has.
 */
export default function LandingPage({ live }: LandingPageProps) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <LandingTopBar live={live} />
      <Box component="main">
        <Hero live={live} />
        <ClosingCallToAction live={live} />
      </Box>
      <LandingFooter live={live} />
    </Box>
  );
}
