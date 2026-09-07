'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
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
import { CURRENCIES } from '@/lib/utils/currency';

export default function SettingsPage() {
  const { data: session } = useSession();
  const [name, setName] = useState('');
  const [preferredCurrency, setPreferredCurrency] = useState('INR');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState('');

  useEffect(() => {
    async function loadProfile() {
      const res = await fetch('/api/user/profile');
      const data = await res.json();
      if (data.data) {
        setName(data.data.name || '');
        setPreferredCurrency(data.data.preferredCurrency || 'INR');
      }
    }
    loadProfile();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, preferredCurrency }),
      });

      if (res.ok) {
        setSnackbar('Settings saved!');
      }
    } catch {
      setSnackbar('Failed to save settings.');
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
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />

            <TextField
              select
              label="Preferred Currency"
              value={preferredCurrency}
              onChange={(e) => setPreferredCurrency(e.target.value)}
              fullWidth
              helperText="Used as default when creating new groups"
            >
              {CURRENCIES.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.flag} {c.code} — {c.name}
                </MenuItem>
              ))}
            </TextField>

            <Button variant="contained" onClick={handleSave} disabled={loading}>
              {loading ? <CircularProgress size={20} /> : 'Save Changes'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

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
            <Typography variant="body2" color="success.main">
              ✓ Active session
            </Typography>
          </Stack>
          <Button
            variant="outlined"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={() => signOut({ callbackUrl: '/' })}
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
