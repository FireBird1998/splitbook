'use client';

import { apiFetch } from '@/lib/utils/api-fetch';
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { format, isToday, isYesterday } from 'date-fns';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import Link from 'next/link';
import { formatDate } from '@splitbook/shared/date';
import { PRODUCT_NAME } from '@/lib/product';
import { assistantAddress } from '@/lib/mcp/assistant-name';
import {
  connectedAssistantAccessLabel,
  type ConnectedAssistant,
  type ConnectedAssistantsPage,
} from '@splitbook/shared/connected-assistant';

function lastUsedLabel(value: string | null): string {
  if (!value) return 'Not used yet';
  const date = new Date(value);
  if (isToday(date)) return `Last used ${format(date, 'HH:mm')}`;
  if (isYesterday(date)) return 'Last used yesterday';
  return `Last used ${formatDate(date, { omitCurrentYear: true })}`;
}

/**
 * Settings' Connected assistants once they have loaded: the MCP URL to add, what assistants can
 * do, each connection with its access and Disconnect, and what disconnecting keeps.
 */
export function ConnectionsList({
  data,
  busy,
  onRevoke,
  onLoadMore,
}: {
  data: ConnectedAssistantsPage;
  busy: string | null;
  onRevoke: (id: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <>
      <Typography variant="body2">
        Add this MCP URL in your assistant, then review the permissions in {PRODUCT_NAME}.
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', userSelect: 'all' }}>
        {data.resource}
      </Typography>
      <Alert severity="info">
        Assistants can answer questions about your Groups, balances and Expenses. If you also let
        one prepare Expenses, it can add, change and permanently delete items in your To review.
        Only you can save Expenses in {PRODUCT_NAME}.
      </Alert>
      {data.connections.length === 0 && (
        <Typography variant="body2">No assistants connected.</Typography>
      )}
      {data.connections.length > 0 && (
        <Box
          component="ul"
          aria-label="Connected assistants"
          sx={{ listStyle: 'none', p: 0, m: 0 }}
        >
          {data.connections.map((connection, index) => {
            const address = assistantAddress(connection.clientId);
            return (
              <Box
                component="li"
                key={connection.id}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 2,
                  rowGap: 1,
                  py: 1.5,
                  borderTop: index > 0 ? 1 : 0,
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ flex: '1 1 16rem', minWidth: 0 }}>
                  <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                    {connection.name}
                  </Typography>
                  {address && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ overflowWrap: 'anywhere' }}
                    >
                      {address}
                    </Typography>
                  )}
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {connectedAssistantAccessLabel(connection.access)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {lastUsedLabel(connection.lastUsedAt)}
                  </Typography>
                </Box>
                {/* Compact and red, as Sign Out is. */}
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  sx={{ color: 'status.negative', borderColor: 'status.negative' }}
                  aria-label={`Disconnect ${connection.name}`}
                  disabled={busy !== null}
                  onClick={() => onRevoke(connection.id)}
                >
                  Disconnect
                </Button>
              </Box>
            );
          })}
        </Box>
      )}
      {data.nextOffset !== null && (
        <Button disabled={busy !== null} onClick={onLoadMore}>
          Load more connections
        </Button>
      )}
      <Typography variant="body2" color="text.secondary">
        Disconnecting blocks further requests and keeps what’s in your To review. Previously shared
        information may remain in your assistant.
      </Typography>
    </>
  );
}

export default function ConnectionsSetting({ accountId }: { accountId?: string }) {
  const [data, setData] = useState<ConnectedAssistantsPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState<ConnectedAssistant | null>(null);
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
      setDialogOpen(false);
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
  return (
    <Paper id="connected-assistants" variant="outlined" sx={{ p: 3, mb: 3 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1" component="h2" fontWeight={600}>
          Connected assistants
        </Typography>
        <Button component={Link} href="/connect/chatgpt" sx={{ alignSelf: 'flex-start' }}>
          Connect ChatGPT
        </Button>
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
          <ConnectionsList
            data={data}
            busy={busy}
            onRevoke={(id) => {
              setPending(data.connections.find((item) => item.id === id) ?? null);
              setDialogOpen(true);
            }}
            onLoadMore={() => void loadMore()}
          />
        )}
        <Dialog
          open={dialogOpen}
          slotProps={{ transition: { onExited: () => setPending(null) } }}
          onClose={() => {
            if (!busy) setDialogOpen(false);
          }}
          aria-labelledby="disconnect-assistant-title"
          aria-describedby="disconnect-assistant-description"
        >
          <DialogTitle id="disconnect-assistant-title">Disconnect {pending?.name}?</DialogTitle>
          <DialogContent>
            <DialogContentText id="disconnect-assistant-description">
              The assistant stops at once. Items already prepared stay in your To review. Previously
              shared information may remain in your assistant.
            </DialogContentText>
            {error && <Alert severity="error">{error}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy !== null} onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="error"
              sx={{ color: 'status.negative' }}
              disabled={busy !== null || !pending}
              onClick={() => {
                if (pending) void revoke(pending.id);
              }}
            >
              Disconnect
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Paper>
  );
}
