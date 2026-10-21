import type { AssistantRule } from './assistant-rule';

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
  /** The Groups the member left out of its reach (#617, #620); absent from older servers. */
  excludedGroupIds?: string[];
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

/** One of the member's Groups as far as an assistant's reach goes: its id and Assistant rule. */
export interface AssistantGroupRef {
  id: string;
  /** Absent on a Group stored before the rule (#621), which is Allowed. */
  rule?: AssistantRule;
}

/**
 * How many of the member's Groups an assistant reaches (#620), for "N of M Groups": those it
 * isn't left out of and whose admins allow assistants (#621). A Group left out that the member
 * has since left counts for nothing.
 */
export function assistantGroupCount(
  groups: readonly AssistantGroupRef[],
  excludedGroupIds: readonly string[] = [],
): { reached: number; of: number } {
  const excluded = new Set(excludedGroupIds);
  return {
    reached: groups.filter((group) => !excluded.has(group.id) && group.rule !== 'not_allowed')
      .length,
    of: groups.length,
  };
}
