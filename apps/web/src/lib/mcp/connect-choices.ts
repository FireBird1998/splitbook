import { PRODUCT_NAME } from '@/lib/product';

/** An assistant a live check knows by the client identity it connects with. */
export type KnownAssistant = { name: string; clientId: string };

export const CHATGPT: KnownAssistant = {
  name: 'ChatGPT',
  clientId: 'https://chatgpt.com/oauth/client.json',
};
// The client identity Claude used on staging (docs/qa/mcp-staging-2026-10-11.md).
export const CLAUDE: KnownAssistant = {
  name: 'Claude',
  clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
};

/** The assistants Connect offers (#619), in the board's order. */
export const CONNECT_CHOICES = [
  { id: 'claude', label: CLAUDE.name },
  { id: 'chatgpt', label: CHATGPT.name },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'other', label: 'Other MCP client' },
] as const;
export type ConnectChoice = (typeof CONNECT_CHOICES)[number]['id'];

/** The choice a link asked for, else Claude. */
export function connectChoice(requested: string | undefined): ConnectChoice {
  return CONNECT_CHOICES.find((choice) => choice.id === requested)?.id ?? 'claude';
}

/** The address that opens one choice's setup, so a link or a sign-in can come back to it. */
export function connectHref(choice: ConnectChoice) {
  return `/connect?assistant=${choice}`;
}

/** A staging deployment's server address, so guides say they're for testing. */
export function isStagingResource(resource: string) {
  return /(^|[.-])staging([.-]|$)/i.test(new URL(resource).hostname);
}

/** The prompt every guide gives to test a connection without reading anything. */
export const TEST_PROMPT = `Use ${PRODUCT_NAME}’s connection_status only and show the result. Don’t read my Groups, balances or Expenses.`;
