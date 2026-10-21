'use client';

import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  connectedAssistantAccessLabel,
  type ConnectedAssistant,
} from '@splitbook/shared/connected-assistant';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import { assistantAddress } from '@/lib/mcp/assistant-name';
import type { ApprovalGroup } from '@/lib/services/assistant-ledger.service';
import { apiFetch } from '@/lib/utils/api-fetch';
import { AssistantGroupChecklist, leavesOutEveryGroup } from './AssistantGroupChecklist';
import {
  DISCONNECT_FAILED,
  readAssistantGroups,
  revokeAssistant,
} from './connected-assistants-client';
import DisconnectDialog from './DisconnectDialog';
import { lastUsedLabel } from './last-used';

const sameGroups = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * One assistant's page (#620): its access and last use, the Groups it reaches, changed from its
 * next call with no new consent, and Disconnect with Settings' confirmation. To review access
 * changes only by connecting again.
 */
export default function AssistantPage({ id, accountId }: { id: string; accountId: string }) {
  const router = useRouter();
  const [assistant, setAssistant] = useState<ConnectedAssistant | null>(null);
  const [groups, setGroups] = useState<readonly ApprovalGroup[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const read = (path: string) =>
      apiFetch(path, {
        signal: controller.signal,
        headers: { [EXPECTED_ACCOUNT_HEADER]: accountId },
        cache: 'no-store',
      });
    Promise.all([
      read(`/api/auth/mcp/connection?${new URLSearchParams({ id })}`),
      readAssistantGroups(accountId, controller.signal),
    ])
      .then(async ([connection, listed]) => {
        if (connection.status === 404)
          throw new Error(
            'This assistant isn’t connected any more. It may have been disconnected or expired.',
          );
        if (!connection.ok || !listed) throw new Error('This assistant could not be loaded.');
        const read: ConnectedAssistant = await connection.json();
        if (controller.signal.aborted) return;
        setAssistant(read);
        setExcluded(read.excludedGroupIds ?? []);
        setGroups(listed);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setLoadError(reason.message);
      });
    return () => controller.abort();
  }, [id, accountId, attempt]);

  const saved = assistant?.excludedGroupIds ?? [];
  const changed = !sameGroups(excluded, saved);
  const noneLeft = leavesOutEveryGroup(groups ?? [], excluded);

  async function save() {
    if (!assistant) return;
    setSaving(true);
    setNotice('');
    setSaveError('');
    try {
      const response = await apiFetch('/api/auth/mcp/connection-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [EXPECTED_ACCOUNT_HEADER]: accountId },
        body: JSON.stringify({ id, excludedGroupIds: excluded }),
      });
      if (!response.ok) throw new Error();
      const { excludedGroupIds } = await response.json();
      setAssistant({ ...assistant, excludedGroupIds });
      setExcluded(excludedGroupIds);
      setNotice(`Saved. ${assistant.name} uses these Groups from its next call.`);
    } catch {
      setSaveError('Your Groups couldn’t be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setDisconnectError('');
    if (await revokeAssistant(id, accountId)) {
      router.replace('/settings#connected-assistants');
      return;
    }
    setDisconnectError(DISCONNECT_FAILED);
    setDisconnecting(false);
  }

  const address = assistant && assistantAddress(assistant.clientId);
  return (
    <Container maxWidth="sm" disableGutters>
      <Stack spacing={3}>
        <Breadcrumbs aria-label="Breadcrumb">
          <Link component={NextLink} href="/settings" underline="hover">
            Settings
          </Link>
          <Link component={NextLink} href="/settings#connected-assistants" underline="hover">
            Connected assistants
          </Link>
          {assistant && (
            <Typography color="text.primary" aria-current="page">
              <bdi>{assistant.name}</bdi>
            </Typography>
          )}
        </Breadcrumbs>
        {loadError ? (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  setLoadError('');
                  setAttempt((value) => value + 1);
                }}
              >
                Reload
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : !assistant || !groups ? (
          <Skeleton variant="rounded" height={240} />
        ) : (
          <>
            <Box>
              <Typography
                component="h1"
                variant="h5"
                fontWeight={700}
                sx={{ overflowWrap: 'anywhere' }}
              >
                <bdi>{assistant.name}</bdi>
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
                {connectedAssistantAccessLabel(assistant.access)} ·{' '}
                {lastUsedLabel(assistant.lastUsedAt)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                To change To review access, disconnect it and connect it again.
              </Typography>
            </Box>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Stack spacing={2}>
                <AssistantGroupChecklist
                  name={assistant.name}
                  viewerId={accountId}
                  groups={groups}
                  excluded={excluded}
                  disabled={saving}
                  onExcludedChange={(next) => {
                    setExcluded(next);
                    setNotice('');
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  Changes here apply from <bdi>{assistant.name}</bdi>’s next call.
                </Typography>
                {saveError && <Alert severity="error">{saveError}</Alert>}
                <Typography role="status" variant="body2">
                  {notice}
                </Typography>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    color="inherit"
                    disabled={!changed || saving}
                    onClick={() => {
                      setExcluded(saved);
                      setSaveError('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    disabled={!changed || noneLeft || saving}
                    onClick={() => void save()}
                  >
                    {saving ? <CircularProgress size={20} /> : 'Save changes'}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
            <Box>
              {/* Compact and red, as in Settings. */}
              <Button
                variant="outlined"
                color="error"
                size="small"
                sx={{ color: 'status.negative', borderColor: 'status.negative' }}
                disabled={disconnecting}
                onClick={() => setDialogOpen(true)}
              >
                Disconnect
              </Button>
            </Box>
            <DisconnectDialog
              name={assistant.name}
              open={dialogOpen}
              busy={disconnecting}
              error={disconnectError}
              onCancel={() => setDialogOpen(false)}
              onConfirm={() => void disconnect()}
            />
          </>
        )}
      </Stack>
    </Container>
  );
}
