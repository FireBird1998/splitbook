'use client';

import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Avatar from '@mui/material/Avatar';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import LogoutIcon from '@mui/icons-material/Logout';
import { CURRENCIES, CURRENCY_CODES } from '@splitbook/shared/currency';
import { updateProfileSchema } from '@splitbook/shared/validators/profile';
import ShortcutsSetting from '@/components/shortcuts/ShortcutsSetting';
import { authClient, signOutToHome } from '@/lib/auth-client';
import { apiFetch } from '@/lib/utils/api-fetch';

export default function SettingsPage() {
  const { data: session } = authClient.useSession();
  const [name, setName] = useState('');
  const [preferredCurrency, setPreferredCurrency] = useState('INR');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState('');
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const edited = useRef({ name: false, currency: false });

  useEffect(() => {
    const controller = new AbortController();
    async function loadProfile() {
      try {
        const res = await apiFetch('/api/user/profile', { signal: controller.signal });
        const data = await res.json();
        if (!res.ok || !data.data)
          throw new Error('Could not load your profile. Please try again.');
        if (controller.signal.aborted) return;
        if (!edited.current.name) setName(data.data.name || '');
        if (!edited.current.currency) {
          setPreferredCurrency(
            CURRENCY_CODES.includes(data.data.preferredCurrency)
              ? data.data.preferredCurrency
              : 'INR',
          );
        }
        setProfileLoaded(true);
      } catch {
        if (!controller.signal.aborted) {
          setProfileLoadError('Could not load your profile. Please try again.');
        }
      }
    }
    void loadProfile();
    return () => controller.abort();
  }, [profileLoadAttempt]);

  const handleSave = async () => {
    if (!profileLoaded) return;
    setError('');
    setSnackbar('');
    const parsed = updateProfileSchema.safeParse({ name, preferredCurrency });
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      if (firstError.path[0] === 'name') setNameError(firstError.message);
      setError(firstError.message);
      return;
    }
    setNameError('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : 'Failed to save settings. Please try again.',
        );
        return;
      }
      setName(parsed.data.name ?? name);
      setSnackbar('Settings saved!');
    } catch {
      setError('Failed to save settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" disableGutters>
      <Typography variant="h5" fontWeight={700} color="text.primary" sx={{ mb: 3 }}>
        Settings
      </Typography>

      {/* Profile */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Stack spacing={3}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary">
            Profile
          </Typography>

          <Stack direction="row" alignItems="center" spacing={2}>
            <Avatar
              src={session?.user?.image || undefined}
              alt={session?.user?.name || 'User'}
              sx={{ width: 64, height: 64 }}
            />
            <Box>
              <Typography fontWeight={500} color="text.primary">
                {session?.user?.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {session?.user?.email}
              </Typography>
            </Box>
          </Stack>

          <Stack spacing={2}>
            {(error || profileLoadError) && (
              <Box role="alert" sx={{ color: 'status.negative' }}>
                {error || profileLoadError}
                {profileLoadError && (
                  <Button
                    onClick={() => {
                      setProfileLoadError('');
                      setProfileLoadAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Retry loading profile
                  </Button>
                )}
              </Box>
            )}
            <TextField
              label="Name"
              value={name}
              onChange={(e) => {
                edited.current.name = true;
                setName(e.target.value);
                setNameError('');
              }}
              error={!!nameError}
              helperText={nameError}
              disabled={loading}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />

            <TextField
              select
              label="Preferred Currency"
              value={preferredCurrency}
              onChange={(e) => {
                edited.current.currency = true;
                setPreferredCurrency(e.target.value);
              }}
              disabled={loading}
              fullWidth
              helperText="Used as default when creating new groups"
            >
              {CURRENCIES.map((c) => (
                <MenuItem
                  key={c.code}
                  value={c.code}
                  onClick={() => {
                    edited.current.currency = true;
                    setPreferredCurrency(c.code);
                  }}
                >
                  {c.flag} {c.code} — {c.name}
                </MenuItem>
              ))}
            </TextField>

            <Button variant="contained" onClick={handleSave} disabled={loading || !profileLoaded}>
              {loading ? <CircularProgress size={20} /> : 'Save Changes'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Keyboard shortcuts (#322) */}
      <ShortcutsSetting />

      {/* Account */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary">
            Account
          </Typography>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="body2" color="text.secondary">
                Signed in
              </Typography>
              <Typography variant="caption" color="text.disabled">
                {session?.user?.email}
              </Typography>
            </Box>
            <Typography variant="body2" color="status.positive">
              ✓ Active session
            </Typography>
          </Stack>
          <Button
            variant="outlined"
            color="error"
            sx={{ color: 'status.negative', borderColor: 'status.negative' }}
            startIcon={<LogoutIcon />}
            onClick={() => void signOutToHome()}
          >
            Sign Out
          </Button>
        </Stack>
      </Paper>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
    </Container>
  );
}
