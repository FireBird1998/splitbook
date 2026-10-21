'use client';

import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { ASSISTANT_CANNOT } from '@/lib/mcp/assistant-limits';
import {
  CHATGPT,
  CLAUDE,
  CONNECT_CHOICES,
  connectChoice,
  connectHref,
  isStagingResource,
  TEST_PROMPT,
} from '@/lib/mcp/connect-choices';
import { PRODUCT_NAME } from '@/lib/product';
import { AssistantAuthorization } from './ChatGPTAuthorization';
import { ChatGPTSetup } from './ConnectChatGPT';
import CopyValue, { useCopy } from './CopyValue';
import { SetupStep, SetupSteps } from './SetupSteps';

const TRY_ASKING = [
  'Who still owes me money, and in which Groups?',
  'What did my Household spend on Food last month?',
  'Show me every Expense I paid for this week.',
];

/**
 * Signing in and approving, the same for every assistant once it opens the sign-in page. To review
 * access is mentioned only where this deployment offers it.
 */
function ApproveStep({ signIn, canPrepare }: { signIn: string; canPrepare: boolean }) {
  return (
    <SetupStep title="Sign in and approve">
      <Typography>
        {signIn} Use the account you use here; only invited accounts can connect.
      </Typography>
      <Typography>
        On the approval page, check the assistant’s name
        {canPrepare
          ? ', then leave To review access off unless you want it to prepare Expenses for you'
          : ''}
        . Untick any Group you want to leave out. Groups you join later are included.
      </Typography>
    </SetupStep>
  );
}

/** What any Connected assistant can and can't do, in the approval page's words (#614). */
function AssistantAbilities({ canPrepare }: { canPrepare: boolean }) {
  const { feedback, copy } = useCopy('Copy unavailable. Select the question and copy it manually.');
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
            {canPrepare && (
              <Typography component="li" variant="body2">
                Prepare Expenses for your To review, if you allow it. Only you save them.
              </Typography>
            )}
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
                <IconButton
                  aria-label={`Copy “${question}”`}
                  onClick={() => void copy(question, 'Question copied.')}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
          <Typography role="status" variant="body2">
            {feedback}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

/**
 * Connect (#619): a picker of assistants, each opening its setup with this deployment's own
 * server address, and what any assistant can and can't do. To review appears only where this
 * deployment can prepare Expenses (canPrepare).
 */
export default function ConnectAssistant({
  resource,
  assistant,
  canPrepare,
}: {
  resource: string | null;
  assistant?: string;
  canPrepare: boolean;
}) {
  const chosen = connectChoice(assistant);
  const staging = resource !== null && isStagingResource(resource);
  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Stack spacing={3}>
        <Breadcrumbs aria-label="Breadcrumb">
          <Link component={NextLink} href="/" underline="hover">
            {PRODUCT_NAME} home
          </Link>
          <Link component={NextLink} href="/settings#connected-assistants" underline="hover">
            Connected assistants
          </Link>
          <Typography color="text.primary" aria-current="page">
            Connect an assistant
          </Typography>
        </Breadcrumbs>
        <Stack spacing={1}>
          {staging && (
            <Box>
              <Chip label="Staging only while we test" color="warning" size="small" />
            </Box>
          )}
          <Typography
            component="h1"
            sx={{
              m: 0,
              fontSize: '1.75rem',
              lineHeight: 1.15,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'text.primary',
            }}
          >
            Connect an assistant
          </Typography>
          <Typography color="text.secondary">
            Works with assistants that let you add a custom connector. It acts as you, with only the
            access you give it.
          </Typography>
        </Stack>
        <Box component="nav" aria-labelledby="connect-choice">
          <Typography id="connect-choice" variant="subtitle2" component="p" sx={{ mb: 1 }}>
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
                component={NextLink}
                href={connectHref(choice.id)}
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
          <Stack spacing={3}>
            <SetupSteps>
              <SetupStep title={`Add ${PRODUCT_NAME} to Claude as a custom connector`}>
                <Typography>
                  In Claude, open Settings, then Connectors, choose Add custom connector, and paste
                  this address.
                </Typography>
                <CopyValue label="server address" value={resource} />
              </SetupStep>
              <ApproveStep
                signIn={`Claude opens ${PRODUCT_NAME}’s sign-in page.`}
                canPrepare={canPrepare}
              />
              <SetupStep title="Try the connection">
                <Typography>
                  In a new chat, turn on the {PRODUCT_NAME} connector and send this prompt.
                </Typography>
                <CopyValue label="test prompt" value={TEST_PROMPT} />
              </SetupStep>
            </SetupSteps>
            <AssistantAuthorization assistant={CLAUDE} returnTo={connectHref('claude')} enabled />
          </Stack>
        ) : chosen === 'chatgpt' ? (
          <Stack spacing={3}>
            <ChatGPTSetup resource={resource} staging={staging} canPrepare={canPrepare} />
            <AssistantAuthorization assistant={CHATGPT} returnTo={connectHref('chatgpt')} enabled />
            <Button component={NextLink} href="/connect/chatgpt" sx={{ alignSelf: 'flex-start' }}>
              Full ChatGPT guide, with help
            </Button>
          </Stack>
        ) : chosen === 'claude-code' ? (
          <SetupSteps>
            <SetupStep title={`Add ${PRODUCT_NAME} to Claude Code`}>
              <Typography>Run this in your terminal.</Typography>
              <CopyValue
                label="command"
                value={`claude mcp add --transport http ${PRODUCT_NAME.toLowerCase()} ${resource}`}
              />
            </SetupStep>
            <ApproveStep
              signIn={`In Claude Code, run /mcp and choose ${PRODUCT_NAME.toLowerCase()}. Your browser opens ${PRODUCT_NAME}’s sign-in page.`}
              canPrepare={canPrepare}
            />
            <SetupStep title="Try it">
              <Typography>
                Run /mcp in Claude Code to check its connection. Then ask in your own words, or
                start with one of the questions below.
              </Typography>
            </SetupStep>
          </SetupSteps>
        ) : (
          <SetupSteps>
            <SetupStep title={`Add ${PRODUCT_NAME} to your MCP client`}>
              <Typography>
                Add a remote MCP server with this address. It uses streamable HTTP and signs you in
                with OAuth, so your client needs to support both.
              </Typography>
              <CopyValue label="server address" value={resource} />
              <Typography variant="body2" color="text.secondary">
                Your client identifies itself with a Client ID Metadata Document: an https address
                that publishes its name. Clients that need an API key or a client secret can’t
                connect.
              </Typography>
            </SetupStep>
            <ApproveStep
              signIn={`Your client opens ${PRODUCT_NAME}’s sign-in page.`}
              canPrepare={canPrepare}
            />
            <SetupStep title="Try it">
              <Typography>
                Ask in your own words, or start with one of the questions below.
              </Typography>
            </SetupStep>
          </SetupSteps>
        )}
        <AssistantAbilities canPrepare={canPrepare} />
      </Stack>
    </Container>
  );
}
