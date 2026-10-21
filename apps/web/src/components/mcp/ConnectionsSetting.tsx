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
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import NextLink from 'next/link';
import Link from '@mui/material/Link';
import { PRODUCT_NAME } from '@/lib/product';
import { assistantAddress } from '@/lib/mcp/assistant-name';
import {
  assistantGroupCount,
  connectedAssistantAccessLabel,
  type ConnectedAssistant,
  type ConnectedAssistantsPage,
} from '@splitbook/shared/connected-assistant';
import { lastUsedLabel } from './last-used';

/** "2 of 3 Groups": the member's Groups an assistant reaches (#620). */
function groupCountLabel(
  groups: readonly { id: string; rule?: string }[],
  excludedGroupIds?: readonly string[],
) {
  const { reached, of } = assistantGroupCount(groups, excludedGroupIds);
  return `${reached} of ${of} ${of === 1 ? 'Group' : 'Groups'}`;
}

/**
 * Settings' confirmation before Disconnect (#615), which an assistant's own page asks too (#620).
 */
export function DisconnectDialog({
  name,
  open,
  busy,
  error,
  onCancel,
  onConfirm,
  onExited,
}: {
  name: string | null;
  open: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  onExited?: () => void;
}) {
  return (
    <Dialog
      open={open}
      slotProps={{ transition: { onExited } }}
      onClose={() => {
        if (!busy) onCancel();
      }}
      aria-labelledby="disconnect-assistant-title"
      aria-describedby="disconnect-assistant-description"
    >
      <DialogTitle id="disconnect-assistant-title">Disconnect {name}?</DialogTitle>
      <DialogContent>
        <DialogContentText id="disconnect-assistant-description">
          The assistant stops at once. Items already prepared stay in your To review. Previously
          shared information may remain in your assistant.
        </DialogContentText>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          color="error"
          sx={{ color: 'status.negative' }}
          disabled={busy || !name}
          onClick={onConfirm}
        >
          Disconnect
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Settings' Connected assistants once they have loaded: the MCP URL to add, what assistants can
 * do, each connection with its access and Disconnect, and what disconnecting keeps.
 */
export function ConnectionsList({
  data,
  groups,
  busy,
  onRevoke,
  onLoadMore,
}: {
  data: ConnectedAssistantsPage;
  /** The member's Groups, for "N of M Groups" (#620); none is shown before they load. */
  groups?: readonly { id: string; rule?: string }[];
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
                  {groups && (
                    <Typography variant="body2" color="text.secondary">
                      {groupCountLabel(groups, connection.excludedGroupIds)}
                    </Typography>
                  )}
                </Box>
                <Link
                  component={NextLink}
                  href={`/settings/assistants/${connection.id}`}
                  variant="body2"
                  underline="hover"
                  aria-label={`Manage ${connection.name}, ${address ?? lastUsedLabel(connection.lastUsedAt)}`}
                >
                  Manage
                </Link>
                {/* Compact and red, as Sign Out is. */}
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  sx={{ color: 'status.negative', borderColor: 'status.negative' }}
                  // Two assistants may share a name: the address, or else the last use, tells
                  // their buttons apart.
                  aria-label={`Disconnect ${connection.name}, ${address ?? lastUsedLabel(connection.lastUsedAt)}`}
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
  const [groups, setGroups] = useState<readonly { id: string; rule?: string }[]>();
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
  // The member's Groups, for each assistant's "N of M Groups" (#620). Without them, no count shows.
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    apiFetch('/api/user/assistant-groups', {
      signal: controller.signal,
      headers: { [EXPECTED_ACCOUNT_HEADER]: accountId },
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        const listed = value?.data?.groups;
        if (!controller.signal.aborted && Array.isArray(listed)) setGroups(listed);
      })
      .catch(() => {});
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
        <Button component={NextLink} href="/connect" sx={{ alignSelf: 'flex-start' }}>
          Connect an assistant
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
            groups={groups}
            busy={busy}
            onRevoke={(id) => {
              setPending(data.connections.find((item) => item.id === id) ?? null);
              setDialogOpen(true);
            }}
            onLoadMore={() => void loadMore()}
          />
        )}
        <DisconnectDialog
          name={pending?.name ?? null}
          open={dialogOpen}
          busy={busy !== null}
          error={error}
          onCancel={() => setDialogOpen(false)}
          onConfirm={() => {
            if (pending) void revoke(pending.id);
          }}
          onExited={() => setPending(null)}
        />
      </Stack>
    </Paper>
  );
}
