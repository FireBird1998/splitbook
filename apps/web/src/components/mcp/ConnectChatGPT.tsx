'use client';

import { useState } from 'react';
import ChatGPTAuthorization from './ChatGPTAuthorization';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PRODUCT_NAME } from '@/lib/product';

const testPrompt = `Run ${PRODUCT_NAME} connection_status only and show the result. Do not read my Groups, balances or expenses.`;

function CopyValue({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback('Copied.');
    } catch {
      setFeedback('Copy unavailable. Select the text above and copy it manually.');
    }
  }
  return (
    <Stack spacing={1}>
      <Typography
        component="p"
        sx={{
          overflowWrap: 'anywhere',
          userSelect: 'all',
          bgcolor: 'action.hover',
          p: 2,
          borderRadius: 1,
        }}
      >
        {value}
      </Typography>
      <Button variant="outlined" onClick={() => void copy()} sx={{ alignSelf: 'flex-start' }}>
        Copy {label}
      </Button>
      <Typography role="status" variant="body2">
        {feedback}
      </Typography>
    </Stack>
  );
}

export default function ConnectChatGPT({ resource }: { resource: string | null }) {
  const staging = resource && /(^|[.-])staging([.-]|$)/i.test(new URL(resource).hostname);
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
              All current and future Groups you belong to are included. Read-only ledger access
              cannot save Expenses or see what’s in your To review.
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
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack component="ol" spacing={3} sx={{ pl: 3, my: 0 }}>
              <Stack component="li" spacing={1} sx={{ display: 'list-item' }}>
                <Typography component="h2" variant="h6">
                  Open ChatGPT Plugins
                </Typography>
                <Typography>
                  Choose the plus button, then “Add custom MCP server”. Give it the name{' '}
                  {PRODUCT_NAME}
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
              </Stack>
              <Stack component="li" spacing={1} sx={{ display: 'list-item' }}>
                <Typography component="h2" variant="h6">
                  Add the server and choose OAuth
                </Typography>
                <Typography>Choose a public endpoint and paste this entire server URL.</Typography>
                <CopyValue label="server URL" value={resource} />
                <Box component="details">
                  <Typography component="summary" sx={{ cursor: 'pointer' }}>
                    OAuth and CIMD details
                  </Typography>
                  <Typography sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                    Use OAuth with Client ID Metadata Document (CIMD). ChatGPT’s client identity is
                    https://chatgpt.com/oauth/client.json. No API key or client secret is needed.
                  </Typography>
                  <Typography>
                    Request ledger:read and offline_access. Do not request drafts:write.
                  </Typography>
                </Box>
                <Typography>
                  Review and acknowledge the warning in ChatGPT, then choose “Create as a plugin”.
                </Typography>
              </Stack>
              <Stack component="li" spacing={1} sx={{ display: 'list-item' }}>
                <Typography component="h2" variant="h6">
                  Authorize read-only access
                </Typography>
                <Typography>
                  Sign in to {PRODUCT_NAME} when prompted. Check the account and permissions, leave
                  Draft access off, and approve. Review the discovered tools and install the plugin
                  in ChatGPT.
                </Typography>
              </Stack>
              <Stack component="li" spacing={1} sx={{ display: 'list-item' }}>
                <Typography component="h2" variant="h6">
                  Try the connection in chat
                </Typography>
                <Typography>
                  Start a new chat, type @ and select your {PRODUCT_NAME} plugin, then send this
                  prompt.
                </Typography>
                <CopyValue label="test prompt" value={testPrompt} />
                <Typography>
                  The test result appears in ChatGPT. Opening ChatGPT or copying a value does not
                  confirm authorization or a successful test.
                </Typography>
              </Stack>
            </Stack>
          </Paper>
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
