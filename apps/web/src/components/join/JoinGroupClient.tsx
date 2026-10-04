'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import GoogleIcon from '@mui/icons-material/Google';
import BrandMark from '@/components/layout/BrandMark';
import type { AuthMode } from '@/lib/auth-mode';
import { authClient, signInWithGoogle } from '@/lib/auth-client';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupCategory } from '@splitbook/shared/types';
import { apiFetch } from '@/lib/utils/api-fetch';

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
          setError('This invite link is invalid or has expired.');
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
        subtitle="Pick a demo persona, then you'll return to this invite."
      />
    );
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error && !group) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <Stack spacing={2} alignItems="center">
          <Typography component="span" sx={{ fontSize: '3rem' }}>
            😕
          </Typography>
          <Typography variant="h6" fontWeight={700} color="text.primary">
            Oops!
          </Typography>
          <Typography color="text.secondary">{error}</Typography>
          <Button variant="outlined" onClick={() => router.push('/')}>
            Go Home
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          textAlign: 'center',
          p: 4,
          borderRadius: '16px',
          maxWidth: 384,
          mx: 2,
        }}
      >
        <Stack spacing={3} alignItems="center">
          <BrandMark size={44} fontSize={20} />
          <Box>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              You&apos;ve been invited to join:
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
              <Typography variant="h6" fontWeight={700} color="text.primary">
                {getGroupTheme(((group?.category as string) || 'other') as GroupCategory).icon}{' '}
                {group?.name as string}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {group?.memberCount as number} member
              {(group?.memberCount as number) !== 1 ? 's' : ''}
            </Typography>
          </Box>

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
        </Stack>
      </Paper>
    </Box>
  );
}
