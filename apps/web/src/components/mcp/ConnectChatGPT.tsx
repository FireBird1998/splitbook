'use client';

import ChatGPTAuthorization from './ChatGPTAuthorization';
import CopyValue from './CopyValue';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { CHATGPT, isStagingResource, TEST_PROMPT } from '@/lib/mcp/connect-choices';
import { PRODUCT_NAME } from '@/lib/product';
import { SetupStep, SetupSteps } from './SetupSteps';

/** ChatGPT's setup steps, on its own guide and in Connect's picker (#619). */
export function ChatGPTSetup({
  resource,
  staging,
  canPrepare,
}: {
  resource: string;
  staging: boolean;
  /** Whether this deployment offers To review access to approve or leave off. */
  canPrepare: boolean;
}) {
  return (
    <SetupSteps>
      <SetupStep title="Open ChatGPT Plugins">
        <Typography>
          Choose the plus button, then “Add custom MCP server”. Give it the name {PRODUCT_NAME}
          {staging ? ' Staging' : ''} and a description such as “Read my shared expenses”.
        </Typography>
        <Button
          component="a"
          href="https://chatgpt.com/plugins"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open ChatGPT (new tab)
        </Button>
      </SetupStep>
      <SetupStep title="Add the server and choose OAuth">
        <Typography>Choose a public endpoint and paste this entire server URL.</Typography>
        <CopyValue label="server URL" value={resource} />
        <Box component="details">
          <Typography component="summary" sx={{ cursor: 'pointer' }}>
            OAuth and CIMD details
          </Typography>
          <Typography sx={{ mt: 1, overflowWrap: 'anywhere' }}>
            Use OAuth with Client ID Metadata Document (CIMD). ChatGPT’s client identity is{' '}
            {CHATGPT.clientId}. No API key or client secret is needed.
          </Typography>
          <Typography>
            Request ledger:read and offline_access. Do not request drafts:write.
          </Typography>
        </Box>
        <Typography>
          Review and acknowledge the warning in ChatGPT, then choose “Create as a plugin”.
        </Typography>
      </SetupStep>
      <SetupStep title="Authorize read-only access">
        <Typography>
          Sign in to {PRODUCT_NAME} when prompted. Check the account and permissions,{' '}
          {canPrepare ? 'leave To review access off, ' : ''}and approve. Review the discovered tools
          and install the plugin in ChatGPT.
        </Typography>
      </SetupStep>
      <SetupStep title="Try the connection in chat">
        <Typography>
          Start a new chat, type @ and select your {PRODUCT_NAME} plugin, then send this prompt.
        </Typography>
        <CopyValue label="test prompt" value={TEST_PROMPT} />
        <Typography>
          The test result appears in ChatGPT. Opening ChatGPT or copying a value does not confirm
          authorization or a successful test.
        </Typography>
      </SetupStep>
    </SetupSteps>
  );
}

export default function ConnectChatGPT({
  resource,
  canPrepare,
}: {
  resource: string | null;
  canPrepare: boolean;
}) {
  const staging = resource && isStagingResource(resource);
  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Stack spacing={3}>
        <Link href="/">{PRODUCT_NAME} home</Link>
        <Stack spacing={1}>
          <Box>
            <Chip label="Guided beta setup" size="small" />{' '}
            {staging && <Chip label="Staging · test environment" color="warning" size="small" />}
          </Box>
          <Typography component="h1" variant="h3">
            Connect ChatGPT
          </Typography>
          <Typography color="text.secondary">
            Ask about your Groups, balances and spending from ChatGPT.
          </Typography>
        </Stack>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h6">
              Your access, your choice
            </Typography>
            <Typography>
              You choose which Groups ChatGPT reaches when you approve, and Groups you join later
              are included. Read-only ledger access cannot save Expenses or see what’s in your To
              review.
            </Typography>
            <Typography>
              Refresh access lets ChatGPT stay authorized between visits until you disconnect.
              Manage access in Settings → Connected assistants. Disconnecting blocks further
              requests; information already shared may remain in ChatGPT.
            </Typography>
            <Button component={Link} href="/settings" sx={{ alignSelf: 'flex-start' }}>
              Manage connected assistants
            </Button>
          </Stack>
        </Paper>
        {!resource ? (
          <Alert severity="info">Not available in this environment</Alert>
        ) : (
          <ChatGPTSetup resource={resource} staging={Boolean(staging)} canPrepare={canPrepare} />
        )}
        <ChatGPTAuthorization enabled={Boolean(resource)} />
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h6">
              Need a hand?
            </Typography>
            <Typography>
              Missing custom-server controls? Availability depends on your ChatGPT account and
              workspace policy. Ask your workspace administrator or check the official setup
              guidance.
            </Typography>
            <Typography>
              Sign-in refused? Use your invited {PRODUCT_NAME} beta account. If you declined consent
              or setup expired, restart from ChatGPT and review access again.
            </Typography>
            <Typography>
              Connection failed? Check the full server URL and OAuth settings, then retry in
              ChatGPT. If status looks stale after connecting or disconnecting, return here and
              refresh your status.
            </Typography>
            <Typography>
              Copy blocked? Select the URL or prompt text and use your browser’s copy command.
            </Typography>
            <Link
              href="https://developers.openai.com/plugins/deploy/connect-chatgpt"
              target="_blank"
              rel="noopener noreferrer"
            >
              Official ChatGPT setup guidance (new tab)
            </Link>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
