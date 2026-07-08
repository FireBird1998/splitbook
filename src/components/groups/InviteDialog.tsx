'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import Snackbar from '@mui/material/Snackbar';

const INVITATION_SAVED_MESSAGE =
  'Invitation saved. No email is sent - share the invite link, or they will see it after signing in with that email.';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
}

export default function InviteDialog({ open, onClose, groupId }: InviteDialogProps) {
  const [email, setEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState('');

  const [inviteLink, setInviteLink] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snackbar, setSnackbar] = useState('');

  const handleEmailInvite = async () => {
    if (!email.trim()) return;
    setEmailLoading(true);
    setEmailError('');

    try {
      const res = await fetch(`/api/groups/${groupId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        setEmailError(data.error || 'Failed to save invitation');
        return;
      }

      setEmailSent(true);
      setEmail('');
      setSnackbar(INVITATION_SAVED_MESSAGE);
    } catch {
      setEmailError('Something went wrong.');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGenerateLink = async () => {
    setLinkLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/invite-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInDays: 7 }),
      });

      const data = await res.json();
      if (res.ok) {
        setInviteLink(data.data.inviteUrl);
      }
    } catch {
      console.error('Failed to generate link');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setSnackbar('Link copied!');
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          Invite Members
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {/* Email Invite */}
            <Box>
              <Typography variant="body2" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
                Invite by email
              </Typography>
              {emailError && (
                <Typography variant="caption" color="error.main" sx={{ mb: 1, display: 'block' }}>
                  {emailError}
                </Typography>
              )}
              {emailSent && (
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                  <CheckIcon fontSize="small" color="success" />
                  <Typography variant="caption" color="success.main">
                    {INVITATION_SAVED_MESSAGE}
                  </Typography>
                </Stack>
              )}
              <Stack direction="row" spacing={1}>
                <TextField
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailSent(false);
                  }}
                  placeholder="friend@gmail.com"
                  size="small"
                  fullWidth
                  type="email"
                />
                <Button
                  variant="contained"
                  onClick={handleEmailInvite}
                  disabled={emailLoading || !email.trim()}
                  sx={{ flexShrink: 0 }}
                >
                  {emailLoading ? <CircularProgress size={20} /> : 'Send'}
                </Button>
              </Stack>
            </Box>

            <Divider>
              <Typography variant="caption" color="text.disabled">
                OR
              </Typography>
            </Divider>

            {/* Invite Link */}
            <Box>
              <Typography variant="body2" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
                Share invite link
              </Typography>
              {inviteLink ? (
                <Stack spacing={0.5}>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      value={inviteLink}
                      size="small"
                      fullWidth
                      slotProps={{ input: { readOnly: true } }}
                      sx={{ '& input': { fontSize: 12 } }}
                    />
                    <IconButton
                      onClick={handleCopy}
                      size="small"
                      color={copied ? 'success' : 'default'}
                    >
                      {copied ? <CheckIcon /> : <ContentCopyIcon />}
                    </IconButton>
                  </Stack>
                  <Typography variant="caption" color="text.disabled">
                    Expires in 7 days
                  </Typography>
                </Stack>
              ) : (
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleGenerateLink}
                  disabled={linkLoading}
                  sx={{ borderColor: 'primary.main', color: 'primary.main' }}
                >
                  {linkLoading ? <CircularProgress size={20} /> : 'Generate Invite Link'}
                </Button>
              )}
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
    </>
  );
}
