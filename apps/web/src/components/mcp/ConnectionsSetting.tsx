'use client';

import { apiFetch } from '@/lib/utils/api-fetch';
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';

interface Connection {
  id: string;
  clientId: string;
  scopes: string[];
}
export default function ConnectionsSetting({ accountId }: { accountId?: string }) {
  const [data, setData] = useState<{
    resource: string;
    connections: Connection[];
    nextOffset: number | null;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    apiFetch('/api/auth/mcp/connections', {
      signal: controller.signal,
      headers: { [EXPECTED_ACCOUNT_HEADER]: accountId },
      cache: 'no-store',
    })
      .then(async (response) => {
        if (response.status === 404) return null; // Deployment has not enabled MCP.
        if (!response.ok) throw new Error('Could not load assistant connections.');
        return response.json();
      })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load assistant connections.');
      });
    return () => controller.abort();
  }, [attempt, accountId]);
  async function revoke(id: string) {
    setBusy(id);
    setError('');
    try {
      const response = await apiFetch('/api/auth/mcp/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [EXPECTED_ACCOUNT_HEADER]: accountId ?? '' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error();
      setData(
        (current) =>
          current && {
            ...current,
            connections: current.connections.filter((item) => item.id !== id),
          },
      );
    } catch {
      setError('Could not confirm disconnection. Reload and try again.');
    } finally {
      setBusy(null);
    }
  }
  async function loadMore() {
    if (data?.nextOffset == null) return;
    setBusy('loading');
    setError('');
    try {
      const response = await apiFetch(`/api/auth/mcp/connections?offset=${data.nextOffset}`, {
        cache: 'no-store',
        headers: { [EXPECTED_ACCOUNT_HEADER]: accountId ?? '' },
      });
      if (!response.ok) throw new Error();
      const next = await response.json();
      setData(
        (current) =>
          current && { ...next, connections: [...current.connections, ...next.connections] },
      );
    } catch {
      setError('Could not load more connections. Try again.');
    } finally {
      setBusy(null);
    }
  }
  if (!data && !error) return null;
  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1" component="h2" fontWeight={600}>
          Connected assistants
        </Typography>
        {error && (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  setError('');
                  setAttempt((value) => value + 1);
                }}
              >
                Reload
              </Button>
            }
          >
            {error}
          </Alert>
        )}
        {data && (
          <>
            <Typography variant="body2">
              Add this MCP URL in your assistant, then review the permissions in SplitBook.
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere', userSelect: 'all' }}>
              {data.resource}
            </Typography>
            <Alert severity="info">
              Assistants can read your ledger. With Draft permission, they can prepare, edit and
              permanently discard your Drafts. Only you can save Expenses in SplitBook.
            </Alert>
            {data.connections.length === 0 && (
              <Typography variant="body2">No assistants connected.</Typography>
            )}
            {data.connections.map((connection) => (
              <Stack key={connection.id} spacing={1}>
                <Typography sx={{ overflowWrap: 'anywhere' }}>{connection.clientId}</Typography>
                <Typography variant="body2">
                  All current and future Groups · Ledger access
                  {connection.scopes.includes(MCP_DRAFT_SCOPE)
                    ? ' · Private Draft access, including permanent discard'
                    : ''}
                </Typography>
                <Button
                  variant="outlined"
                  disabled={busy !== null}
                  onClick={() => void revoke(connection.id)}
                >
                  Disconnect
                </Button>
              </Stack>
            ))}
            {data.nextOffset !== null && (
              <Button disabled={busy !== null} onClick={() => void loadMore()}>
                Load more connections
              </Button>
            )}
            <Typography variant="body2" color="text.secondary">
              Disconnecting blocks further requests and keeps your Drafts. Previously shared
              information may remain in your assistant.
            </Typography>
          </>
        )}
      </Stack>
    </Paper>
  );
}
