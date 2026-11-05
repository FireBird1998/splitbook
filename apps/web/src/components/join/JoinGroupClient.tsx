'use client';

import { createElement, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import GoogleIcon from '@mui/icons-material/Google';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import { visuallyHidden } from '@/components/common/visually-hidden';
import BrandLogo from '@/components/layout/BrandLogo';
import BrandMark from '@/components/layout/BrandMark';
import { groupThemeIcon } from '@/components/layout/group-theme-icons';
import { PRODUCT_NAME } from '@/lib/product';
import type { AuthMode } from '@/lib/auth-mode';
import { authClient, signInWithGoogle } from '@/lib/auth-client';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import type { GroupCategory } from '@splitbook/shared/types';
import { apiFetch } from '@/lib/utils/api-fetch';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { SEPARATOR, counted } from '@splitbook/shared/separator';
import { RADIUS } from '@/lib/theme/tokens';

interface JoinGroupClientProps {
  code: string;
  authMode: AuthMode;
}

export default function JoinGroupClient({ code, authMode }: JoinGroupClientProps) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const authenticated = Boolean(session?.user);

  const [group, setGroup] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);

  useEffect(() => {
    async function loadGroup() {
      try {
        const res = await apiFetch(`/api/join/${code}`);
        if (res.ok) {
          const data = await res.json();
          setGroup(data.data);
        } else {
          setError(
            'This invite link has expired or isn’t valid. Ask whoever sent it for a new one.',
          );
        }
      } catch {
        setError('Failed to load group information.');
      } finally {
        setLoading(false);
      }
    }
    loadGroup();
  }, [code]);

  const handleJoin = async () => {
    setJoining(true);
    try {
      const res = await apiFetch(`/api/join/${code}`, { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        router.push(`/groups/${data.data.groupId}`);
      } else {
        setError(data.error || 'Failed to join group');
      }
    } catch {
      setError('Something went wrong.');
    } finally {
      setJoining(false);
    }
  };

  const handleSignIn = () => {
    if (authMode === 'demo') {
      setShowPersonaPicker(true);
      return;
    }
    void signInWithGoogle(`/join/${code}`);
  };

  if (showPersonaPicker && authMode === 'demo') {
    return (
      <DemoPersonaPicker
        callbackUrl={`/join/${code}`}
        title="Sign in to join"
        subtitle="Pick a demo persona, then you’ll return to this invite."
      />
    );
  }

  if (loading) {
    // The mark and "Loading…", as Sign in loads (#646).
    return (
      <JoinPage>
        <Typography component="h1" sx={visuallyHidden}>
          Join Group
        </Typography>
        <Box
          role="status"
          sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
        >
          <BrandMark size={48} decorative={false} />
          <Typography color="text.secondary">Loading…</Typography>
        </Box>
      </JoinPage>
    );
  }

  if (error && !group) {
    return (
      <JoinPage>
        <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', maxWidth: 384 }}>
          <JoinTile kind="error">
            <LinkOffOutlinedIcon sx={{ fontSize: 28 }} />
          </JoinTile>
          <Typography component="h1" sx={titleSx}>
            Can’t open this invite
          </Typography>
          <Typography color="text.secondary">{error}</Typography>
          <Button variant="outlined" onClick={() => router.push('/')}>
            Go to Home
          </Button>
        </Stack>
      </JoinPage>
    );
  }

  const category = ((group?.category as string) || 'other') as GroupCategory;

  return (
    <JoinPage>
      <Paper
        variant="outlined"
        sx={{
          textAlign: 'center',
          p: 4,
          borderRadius: '16px',
          width: '100%',
          maxWidth: 384,
        }}
      >
        <Stack spacing={3} alignItems="center">
          <Stack alignItems="center">
            <JoinTile kind={category}>
              {createElement(groupThemeIcon(category), { sx: { fontSize: 28 } })}
            </JoinTile>
            <Typography color="text.secondary" sx={{ mt: 2, mb: 1 }}>
              You’ve been invited to join
            </Typography>
            <Typography component="h1" sx={titleSx}>
              {group?.name as string}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {inviteSummary(category, group?.memberCount as number)}
            </Typography>
          </Stack>

          {error && (
            <Typography color="error.main" variant="body2">
              {error}
            </Typography>
          )}

          {authenticated ? (
            <Button
              variant="contained"
              fullWidth
              onClick={handleJoin}
              disabled={joining}
              sx={{ py: 1.5 }}
            >
              {joining ? <CircularProgress size={20} /> : 'Join Group'}
            </Button>
          ) : (
            <Button
              variant="contained"
              fullWidth
              startIcon={authMode === 'google' ? <GoogleIcon /> : undefined}
              onClick={handleSignIn}
              sx={{ py: 1.5 }}
            >
              {authMode === 'demo' ? 'Sign in to Join' : 'Sign in with Google to Join'}
            </Button>
          )}

          <Box sx={{ width: '100%' }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              {PRODUCT_NAME} keeps a shared record of what the Group spends and who owes whom.
            </Typography>
          </Box>
        </Stack>
      </Paper>
    </JoinPage>
  );
}

/** "Household · 3 members": the Theme, then the count kept whole with its noun (#646). */
function inviteSummary(category: GroupCategory, memberCount: number): string {
  return `${getGroupTheme(category).label}${SEPARATOR}${counted(memberCount, 'member')}`;
}

/** The page's title style: the Group page header's h1 (board WebJoin, #646). */
const titleSx = {
  m: 0,
  fontSize: '1.75rem',
  lineHeight: 1.15,
  fontWeight: 600,
  letterSpacing: '-0.02em',
  color: 'text.primary',
  overflowWrap: 'anywhere',
} as const;

/**
 * The 56 px tile above the title: the Group's Theme icon on the brand tint, or a broken link on
 * the negative tint when the invite can't be opened. Decorative: the title says it all.
 */
function JoinTile({ kind, children }: { kind: GroupCategory | 'error'; children: ReactNode }) {
  return (
    <Box
      aria-hidden
      data-join-tile={kind}
      sx={{
        width: 56,
        height: 56,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: `${RADIUS.lg}px`,
        bgcolor: kind === 'error' ? 'tint.negative' : 'tint.brand',
        color: kind === 'error' ? 'status.negative' : 'primary.main',
      }}
    >
      {children}
    </Box>
  );
}

/** The invite page: the logo, linking home, above the centred content. */
function JoinPage({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <Box component="header" sx={{ display: 'flex', px: { xs: 2, sm: 5 }, py: 2.5 }}>
        <BrandLogo height={32} href="/" />
      </Box>
      <Box
        component="main"
        sx={{
          flex: '1 1 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          pt: 3,
          pb: 7,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
