'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { ASSISTANT_CANNOT } from '@/lib/mcp/assistant-limits';
import { PRODUCT_NAME } from '@/lib/product';
import { AssistantAuthorization, CHATGPT, CLAUDE } from './ChatGPTAuthorization';
import { ChatGPTSetup, isStagingResource } from './ConnectChatGPT';
import CopyValue from './CopyValue';

/** The assistants Connect offers (#619), in the board's order. */
export const CONNECT_CHOICES = [
  { id: 'claude', label: 'Claude' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'other', label: 'Other MCP client' },
] as const;
export type ConnectChoice = (typeof CONNECT_CHOICES)[number]['id'];

/** The choice a link asked for, else Claude. */
export function connectChoice(requested: string | undefined): ConnectChoice {
  return CONNECT_CHOICES.find((choice) => choice.id === requested)?.id ?? 'claude';
}

const TEST_PROMPT = `Use ${PRODUCT_NAME}'s connection_status only and show the result. Don't read my Groups, balances or Expenses.`;
const TRY_ASKING = [
  'Who still owes me money, and in which Groups?',
  'What did my Household spend on Food last month?',
  'Show me every Expense I paid for this week.',
];

/** One numbered step of a setup. */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack component="li" spacing={1} sx={{ display: 'list-item' }}>
      <Typography component="h2" variant="h6">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

/** Signing in and approving, the same for every assistant once it opens the sign-in page. */
function ApproveStep({ signIn }: { signIn: string }) {
  return (
    <Step title="Sign in and approve">
      <Typography>
        {signIn} Use the account you use here; only invited accounts can connect.
      </Typography>
      <Typography>
        On the approval page, check the assistant’s name, then leave To review access off unless you
        want it to prepare Expenses for you. Untick any Group you want to leave out. Groups you join
        later are included.
      </Typography>
    </Step>
  );
}

function ClaudeSetup({ resource }: { resource: string }) {
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack component="ol" spacing={3} sx={{ pl: 3, my: 0 }}>
          <Step title={`Add ${PRODUCT_NAME} to Claude as a custom connector`}>
            <Typography>
              In Claude, open Settings, then Connectors, choose Add custom connector, and paste this
              address.
            </Typography>
            <CopyValue label="server address" value={resource} />
          </Step>
          <ApproveStep signIn={`Claude opens ${PRODUCT_NAME}’s sign-in page.`} />
          <Step title="Try the connection">
            <Typography>
              In a new chat, turn on the {PRODUCT_NAME} connector and send this prompt.
            </Typography>
            <CopyValue label="test prompt" value={TEST_PROMPT} />
          </Step>
        </Stack>
      </Paper>
      <AssistantAuthorization assistant={CLAUDE} enabled />
    </Stack>
  );
}

function ClaudeCodeSetup({ resource }: { resource: string }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack component="ol" spacing={3} sx={{ pl: 3, my: 0 }}>
        <Step title={`Add ${PRODUCT_NAME} to Claude Code`}>
          <Typography>Run this in your terminal.</Typography>
          <CopyValue
            label="command"
            value={`claude mcp add --transport http ${PRODUCT_NAME.toLowerCase()} ${resource}`}
          />
        </Step>
        <ApproveStep
          signIn={`In Claude Code, run /mcp and choose ${PRODUCT_NAME.toLowerCase()}. Your browser opens ${PRODUCT_NAME}’s sign-in page.`}
        />
        <Step title="Try it">
          <Typography>Ask in your own words, or start with one of the questions below.</Typography>
        </Step>
      </Stack>
    </Paper>
  );
}

function OtherSetup({ resource }: { resource: string }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack component="ol" spacing={3} sx={{ pl: 3, my: 0 }}>
        <Step title={`Add ${PRODUCT_NAME} to your MCP client`}>
          <Typography>
            Add a remote MCP server with this address. It uses streamable HTTP and signs you in with
            OAuth, so your client needs to support both.
          </Typography>
          <CopyValue label="server address" value={resource} />
          <Typography variant="body2" color="text.secondary">
            Your client identifies itself with a Client ID Metadata Document: an https address that
            publishes its name. Clients that need an API key or a client secret can’t connect.
          </Typography>
        </Step>
        <ApproveStep signIn={`Your client opens ${PRODUCT_NAME}’s sign-in page.`} />
        <Step title="Try it">
          <Typography>Ask in your own words, or start with one of the questions below.</Typography>
        </Step>
      </Stack>
    </Paper>
  );
}

/** What any Connected assistant can and can't do, in the approval page's words (#614). */
function AssistantAbilities() {
  const [copied, setCopied] = useState('');
  async function copy(question: string) {
    try {
      await navigator.clipboard.writeText(question);
      setCopied('Question copied.');
    } catch {
      setCopied('Copy unavailable. Select the question and copy it manually.');
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="h6">
          What an assistant can do
        </Typography>
        <Box>
          <Typography variant="subtitle2" component="h3">
            It can
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            <Typography component="li" variant="body2">
              Answer questions about your Groups, balances and Expenses
            </Typography>
            <Typography component="li" variant="body2">
              Prepare Expenses for your To review, if you allow it. Only you save them.
            </Typography>
          </Box>
        </Box>
        <Box>
          <Typography variant="subtitle2" component="h3">
            It can’t
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {ASSISTANT_CANNOT.map((limit) => (
              <Typography key={limit} component="li" variant="body2">
                {limit}
              </Typography>
            ))}
          </Box>
        </Box>
        <Box>
          <Typography variant="subtitle2" component="h3">
            Try asking
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
            {TRY_ASKING.map((question) => (
              <Box
                key={question}
                component="li"
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Typography variant="body2" sx={{ flex: 1 }}>
                  “{question}”
                </Typography>
                <IconButton aria-label={`Copy “${question}”`} onClick={() => void copy(question)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
          <Typography role="status" variant="body2">
            {copied}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

/**
 * Connect (#619): a picker of assistants, each opening its setup with this deployment's own
 * server address, and what any assistant can and can't do.
 */
export default function ConnectAssistant({
  resource,
  assistant,
}: {
  resource: string | null;
  assistant?: string;
}) {
  const chosen = connectChoice(assistant);
  const staging = resource !== null && isStagingResource(resource);
  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Stack spacing={3}>
        <Link href="/">{PRODUCT_NAME} home</Link>
        <Stack spacing={1}>
          {staging && (
            <Box>
              <Chip label="Staging only while we test" color="warning" size="small" />
            </Box>
          )}
          <Typography component="h1" variant="h3">
            Connect an assistant
          </Typography>
          <Typography color="text.secondary">
            Works with assistants that let you add a custom connector. It acts as you, with only the
            access you give it.
          </Typography>
        </Stack>
        <Box component="nav" aria-label="Your assistant">
          <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
            Your assistant
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
              gap: 1,
            }}
          >
            {CONNECT_CHOICES.map((choice) => (
              <Button
                key={choice.id}
                component={Link}
                href={`/connect?assistant=${choice.id}`}
                aria-current={choice.id === chosen ? 'page' : undefined}
                variant={choice.id === chosen ? 'contained' : 'outlined'}
                scroll={false}
              >
                {choice.label}
              </Button>
            ))}
          </Box>
        </Box>
        {!resource ? (
          <Alert severity="info">Not available in this environment</Alert>
        ) : chosen === 'claude' ? (
          <ClaudeSetup resource={resource} />
        ) : chosen === 'chatgpt' ? (
          <Stack spacing={3}>
            <ChatGPTSetup resource={resource} staging={staging} />
            <AssistantAuthorization assistant={CHATGPT} enabled />
            <Button component={Link} href={CHATGPT.guide} sx={{ alignSelf: 'flex-start' }}>
              Full ChatGPT guide, with help
            </Button>
          </Stack>
        ) : chosen === 'claude-code' ? (
          <ClaudeCodeSetup resource={resource} />
        ) : (
          <OtherSetup resource={resource} />
        )}
        <AssistantAbilities />
      </Stack>
    </Container>
  );
}
