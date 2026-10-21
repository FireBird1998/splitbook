'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { z } from 'zod';
import { authClient } from '@/lib/auth-client';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import { apiFetch } from '@/lib/utils/api-fetch';
import { MCP_DRAFT_SCOPE, MCP_LEDGER_SCOPE } from '@/lib/mcp/config';

/** An assistant this check knows by the client identity it connects with (#619). */
export type KnownAssistant = { name: string; clientId: string; guide: string };
export const CHATGPT: KnownAssistant = {
  name: 'ChatGPT',
  clientId: 'https://chatgpt.com/oauth/client.json',
  guide: '/connect/chatgpt',
};
// The client identity Claude used on staging (docs/qa/mcp-staging-2026-10-11.md).
export const CLAUDE: KnownAssistant = {
  name: 'Claude',
  clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  guide: '/connect?assistant=claude',
};
const connectionPage = z.object({
  connections: z.array(
    z.object({ id: z.string(), clientId: z.string(), scopes: z.array(z.string()) }),
  ),
  nextOffset: z.number().int().nonnegative().nullable(),
});
type Connection = z.infer<typeof connectionPage>['connections'][number];
type Status =
  | { kind: 'loading' | 'unavailable' | 'error' | 'signed-out' }
  | { kind: 'ready'; connections: Connection[] };

function SignIn({ guide }: { guide: string }) {
  return (
    <Button component={Link} href={`/login?${new URLSearchParams({ callbackUrl: guide })}`}>
      Sign in to check your connection
    </Button>
  );
}

/** One assistant's authorizations for this account, each with the access it was granted. */
export function AuthorizedConnections({
  name,
  connections,
}: {
  name: string;
  connections: Connection[];
}) {
  return (
    <Stack spacing={2}>
      <Alert severity="success">{name} authorized</Alert>
      {connections.map((connection, index) => (
        <Stack key={connection.id} spacing={1}>
          <Typography fontWeight={600}>Authorization {index + 1}</Typography>
          {connection.scopes.map((scope) => (
            <Typography key={scope} variant="body2">
              {scope === MCP_LEDGER_SCOPE
                ? 'Read Groups, Balances and spending'
                : scope === MCP_DRAFT_SCOPE
                  ? 'To review access, including permanent deletion'
                  : scope === 'offline_access'
                    ? 'Continued access between visits (refresh tokens)'
                    : scope}
            </Typography>
          ))}
          {connection.scopes.includes(MCP_DRAFT_SCOPE) && (
            <Typography variant="body2">
              This connection has broader access than this read-only guide. To change it, disconnect
              in Settings and reconnect without To review access.
            </Typography>
          )}
        </Stack>
      ))}
      <Typography>
        Authorization confirms your permission, not a successful tool test. Run the test prompt in{' '}
        {name} to check the connection.
      </Typography>
    </Stack>
  );
}

// Account and refresh keys remount this reader: old data disappears synchronously,
// and cleanup prevents any response from an earlier reader restoring it.
function ConnectionStatus({
  accountId,
  assistant,
}: {
  accountId: string;
  assistant: KnownAssistant;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      const matches: Connection[] = [];
      let offset = 0;
      do {
        const response = await apiFetch(`/api/auth/mcp/connections?offset=${offset}`, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { [EXPECTED_ACCOUNT_HEADER]: accountId },
        });
        if (controller.signal.aborted) return;
        if (response.status === 404 || response.status === 401) {
          setStatus({ kind: response.status === 404 ? 'unavailable' : 'signed-out' });
          return;
        }
        if (!response.ok) throw new Error('Connection check failed');
        const data = connectionPage.parse(await response.json());
        matches.push(...data.connections.filter((item) => item.clientId === assistant.clientId));
        if (data.nextOffset === null) break;
        if (data.nextOffset <= offset) throw new Error('Invalid connection page');
        offset = data.nextOffset;
      } while (!controller.signal.aborted);
      if (!controller.signal.aborted) setStatus({ kind: 'ready', connections: matches });
    }
    void check().catch(() => {
      if (!controller.signal.aborted) setStatus({ kind: 'error' });
    });
    return () => controller.abort();
  }, [accountId, assistant.clientId]);

  if (status.kind === 'loading')
    return <Typography role="status">Checking authorization…</Typography>;
  if (status.kind === 'signed-out')
    return (
      <>
        <Typography>Your session ended. Sign in again to check access.</Typography>
        <SignIn guide={assistant.guide} />
      </>
    );
  if (status.kind === 'unavailable')
    return <Alert severity="info">Connection checking is unavailable in this environment.</Alert>;
  if (status.kind === 'error')
    return (
      <Alert severity="error">
        Could not check authorization. This does not mean you are disconnected. Refresh status to
        retry; check that your account is eligible.
      </Alert>
    );
  if (status.kind !== 'ready') return null;
  if (status.connections.length === 0)
    return (
      <Typography role="status">{assistant.name} is not authorized for this account.</Typography>
    );
  return <AuthorizedConnections name={assistant.name} connections={status.connections} />;
}

/** Whether a known assistant is authorized for the signed-in member, checked on demand. */
export function AssistantAuthorization({
  assistant,
  enabled,
}: {
  assistant: KnownAssistant;
  enabled: boolean;
}) {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const [attempt, setAttempt] = useState(0);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="h6">
          Check your authorization
        </Typography>
        {isPending ? (
          <Typography role="status">Checking your session…</Typography>
        ) : error ? (
          <>
            <Alert severity="error">Could not check your session. Try again.</Alert>
            <Button onClick={() => void refetch()}>Retry session check</Button>
          </>
        ) : !session ? (
          <SignIn guide={assistant.guide} />
        ) : !enabled ? (
          <Typography>Connection checking is unavailable in this environment.</Typography>
        ) : (
          <>
            <ConnectionStatus
              key={`${session.user.id}:${attempt}`}
              accountId={session.user.id}
              assistant={assistant}
            />
            <Button onClick={() => setAttempt((value) => value + 1)}>Refresh status</Button>
          </>
        )}
        {session && !isPending && !error && (
          <Button component={Link} href="/settings#connected-assistants">
            Manage access in Settings
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

export default function ChatGPTAuthorization({ enabled }: { enabled: boolean }) {
  return <AssistantAuthorization assistant={CHATGPT} enabled={enabled} />;
}
