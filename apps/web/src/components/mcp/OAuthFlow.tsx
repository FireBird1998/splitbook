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
import { ASSISTANT_CANNOT } from '@/lib/mcp/assistant-limits';
import type { AssistantDisplay } from '@/lib/mcp/assistant-name';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { PRODUCT_NAME } from '@/lib/product';

/** A connection request as the approval page shows it: the assistant, and what it asks for. */
type ConsentDetails = AssistantDisplay & { scopes: string[] };

/**
 * The permissions a connection request asks for, as the approval page lists them: the assistant
 * by name, with its address in small text when it has one (#614), ledger access, and, when it
 * asks for them, preparing items for To review and staying connected; then what it can't do, on
 * every approval.
 */
export function ConsentPermissions({
  details,
  drafts,
  busy,
  onDraftsChange,
}: {
  details: ConsentDetails;
  drafts: boolean;
  busy: boolean;
  onDraftsChange: (drafts: boolean) => void;
}) {
  return (
    <>
      <Box>
        <Typography variant="h6" component="h2">
          {details.name} wants to use your {PRODUCT_NAME}
        </Typography>
        {details.address && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {details.address} · identified by its published details
          </Typography>
        )}
      </Box>
      <Box>
        <Typography variant="subtitle2" component="h3">
          What {details.name} can do
        </Typography>
        <Typography>Ledger permission: read Group details, Balances and spending.</Typography>
      </Box>
      {details.scopes.includes(MCP_DRAFT_SCOPE) && (
        <FormControlLabel
          control={
            <Checkbox
              checked={drafts}
              onChange={(event) => onDraftsChange(event.target.checked)}
              disabled={busy}
            />
          }
          label="Also let it prepare Expenses for your To review"
        />
      )}
      {details.scopes.includes(MCP_DRAFT_SCOPE) && (
        <Typography variant="body2">
          It can add, change and permanently delete items in your To review. Only you can save them
          as Expenses, in {PRODUCT_NAME}.
        </Typography>
      )}
      {details.scopes.includes('offline_access') && (
        <Typography variant="body2">
          The assistant may stay connected while you are away, until you disconnect it.
        </Typography>
      )}
      <Box>
        <Typography variant="subtitle2" component="h3">
          What {details.name} can’t do
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {ASSISTANT_CANNOT.map((limit) => (
            <Typography key={limit} component="li" variant="body2">
              {limit}
            </Typography>
          ))}
        </Box>
      </Box>
    </>
  );
}

export default function OAuthFlow({
  query,
  consent,
  accountId,
}: {
  query: string;
  consent: boolean;
  accountId: string;
}) {
  const [details, setDetails] = useState<ConsentDetails | null>(null);
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
            {consent ? 'Connect an assistant' : `Continue connecting to ${PRODUCT_NAME}`}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {consent ? (
            <>
              <Typography>
                This connection can access all Groups you belong to now and any you join in the
                future, while you remain a member.
              </Typography>
              {details && (
                <ConsentPermissions
                  details={details}
                  drafts={drafts}
                  busy={busy}
                  onDraftsChange={setDrafts}
                />
              )}
              <Alert severity="info">
                Prepared items don’t change Balances until you save them.
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
