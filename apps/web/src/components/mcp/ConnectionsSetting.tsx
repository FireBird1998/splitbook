'use client';

import { apiFetch } from '@/lib/utils/api-fetch';
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
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

interface Connection {
  id: string;
  clientId: string;
  scopes: string[];
  access: string;
  name: string;
  lastUsedAt: string | null;
}
interface Connections {
  resource: string;
  connections: Connection[];
  nextOffset: number | null;
}

function lastUsedLabel(value: string | null): string {
  if (!value) return 'Not used yet';
  const date = new Date(value);
  if (isToday(date)) return `Last used ${format(date, 'HH:mm')}`;
  if (isYesterday(date)) return 'Last used yesterday';
  return `Last used ${formatDate(date, { omitCurrentYear: true })}`;
}

/** A metadata address helps distinguish same-named assistants; registered ids are not URLs. */
function assistantAddress(clientId: string): string | null {
  try {
    const url = new URL(clientId);
    return ['https:', 'http:'].includes(url.protocol)
      ? `${url.host}${url.pathname === '/' ? '' : url.pathname}`
      : null;
  } catch {
    return null;
  }
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
  data: Connections;
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
        Assistants can read your ledger. If you also let one prepare Expenses, it can add, change
        and permanently delete items in your To review. Only you can save Expenses in {PRODUCT_NAME}
        .
      </Alert>
      {data.connections.length === 0 && (
        <Typography variant="body2">No assistants connected.</Typography>
      )}
      {data.connections.map((connection) => (
        <Stack key={connection.id} spacing={1}>
          <Typography sx={{ overflowWrap: 'anywhere' }}>{connection.name}</Typography>
          {assistantAddress(connection.clientId) && (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {assistantAddress(connection.clientId)}
            </Typography>
          )}
          <Typography variant="body2">{connection.access}</Typography>
          <Typography variant="body2" color="text.secondary">
            {lastUsedLabel(connection.lastUsedAt)}
          </Typography>
          <Button
            variant="outlined"
            disabled={busy !== null}
            onClick={() => onRevoke(connection.id)}
          >
            Disconnect
          </Button>
        </Stack>
      ))}
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
  const [data, setData] = useState<Connections | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState<Connection | null>(null);
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
