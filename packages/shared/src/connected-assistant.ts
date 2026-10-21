/**
 * A Connected assistant as Settings reads it from `GET /api/auth/mcp/connections`, on the web
 * and on Android (#622). The server decides its access; clients only word it.
 */
export interface ConnectedAssistant {
  id: string;
  clientId: string;
  name: string;
  scopes: string[];
  /** `Ledger`, or `Ledger + To review` when it may prepare Expenses for the member's To review. */
  access: string;
  lastUsedAt: string | null;
}

/** One page of a member's Connected assistants, with the MCP URL to add. */
export interface ConnectedAssistantsPage {
  resource: string;
  connections: ConnectedAssistant[];
  nextOffset: number | null;
}

const ACCESS_LABELS: Record<string, string> = {
  Ledger: 'Read only',
  'Ledger + To review': 'Read only + To review',
};

/**
 * A connection's access in the words Settings shows (#615). An access this doesn't know is shown
 * as the server sent it, rather than hidden.
 */
export function connectedAssistantAccessLabel(access: string): string {
  return ACCESS_LABELS[access] ?? access;
}
