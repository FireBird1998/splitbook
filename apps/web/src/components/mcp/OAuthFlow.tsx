'use client';

import { apiFetch } from '@/lib/utils/api-fetch';
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';

export default function OAuthFlow({
  query,
  consent,
  accountId,
}: {
  query: string;
  consent: boolean;
  accountId: string;
}) {
  const [details, setDetails] = useState<{ clientId: string; scopes: string[] } | null>(null);
  const [drafts, setDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!consent) return;
    const controller = new AbortController();
    apiFetch(`/api/auth/mcp/consent-details?${new URLSearchParams({ oauth_query: query })}`, {
      headers: { [EXPECTED_ACCOUNT_HEADER]: accountId },
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'This connection request is invalid, expired, or unavailable to your account. Restart from your assistant.',
          );
        return response.json();
      })
      .then((value) => {
        if (!controller.signal.aborted) setDetails(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [query, consent, accountId]);

  async function submit(accept = true) {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/auth/oauth2/${consent ? 'consent' : 'continue'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [EXPECTED_ACCOUNT_HEADER]: accountId },
        body: JSON.stringify({
          oauth_query: query,
          ...(consent
            ? {
                accept,
                scope: details?.scopes
                  .filter((scope) => scope !== MCP_DRAFT_SCOPE || drafts)
                  .join(' '),
              }
            : { selected: true }),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          'Connection could not continue. Restart from your assistant and try again.',
        );
      const destination = result.url ?? result.redirect_uri;
      if (typeof destination !== 'string')
        throw new Error('No callback was returned. Restart from your assistant.');
      // Only the authorization server supplies this validated OAuth callback.
      window.location.assign(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connection failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', p: 3, py: 6 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            {consent ? 'Connect an assistant' : 'Continue connecting to SplitBook'}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {consent ? (
            <>
              <Typography>
                This connection can access all Groups you belong to now and any you join in the
                future, while you remain a member.
              </Typography>
              {details && (
                <>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    Client identity: {details.clientId}
                  </Typography>
                  <Typography>
                    Ledger permission: read Group details, Balances and spending.
                  </Typography>
                  {details.scopes.includes(MCP_DRAFT_SCOPE) && (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={drafts}
                          onChange={(event) => setDrafts(event.target.checked)}
                          disabled={busy}
                        />
                      }
                      label="Also let it prepare expenses for your To review"
                    />
                  )}
                  {details.scopes.includes(MCP_DRAFT_SCOPE) && (
                    <Typography variant="body2">
                      It can add, change and delete items in your To review. Only you can save them
                      as expenses, in Splitbook.
                    </Typography>
                  )}
                  {details.scopes.includes('offline_access') && (
                    <Typography variant="body2">
                      The assistant may stay connected while you are away, until you disconnect it.
                    </Typography>
                  )}
                </>
              )}
              <Alert severity="info">
                Prepared items don&apos;t change Balances until you save them.
              </Alert>
              <Typography variant="body2">
                Disconnect at any time in Settings. Your To review items stay yours; disconnecting
                cannot erase information already shared with the assistant.
              </Typography>
              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  disabled={busy || !details}
                  onClick={() => void submit()}
                >
                  Allow connection
                </Button>
                <Button disabled={busy || !details} onClick={() => void submit(false)}>
                  Deny
                </Button>
              </Stack>
            </>
          ) : (
            <>
              <Typography>
                You are signed in. Continue to review the permissions requested by your assistant.
              </Typography>
              <Button variant="contained" disabled={busy} onClick={() => void submit()}>
                Continue
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
