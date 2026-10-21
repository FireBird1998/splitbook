import { z } from 'zod';
import { ASSISTANT_RULES } from '@splitbook/shared/assistant-rule';
import { assistantGroupCount } from '@splitbook/shared/connected-assistant';
import type { AccountGroupRecordStore } from './account-record-storage';
import { createSavedCopyQueue } from './home-queries';
import { cachedRead } from './offline-cache';
import { RequestError, Superseded } from './transport';
import type { AccountStorageLease } from './types';

/** The member's Connected assistants, as Settings on the web reads them (#615, #620). */
export const assistantsPath = '/api/auth/mcp/connections';
/** The member's Groups as an assistant's reach counts them (#620). */
export const assistantGroupsPath = '/api/user/assistant-groups';
/** The most pages of connections read at once: 25 each, far more than a member connects. */
const PAGES = 20;

const connectionSchema = z.object({
  id: z.string().min(1),
  clientId: z.string(),
  name: z.string(),
  access: z.string(),
  lastUsedAt: z.string().nullable(),
  excludedGroupIds: z.array(z.string()).optional(),
});
const pageSchema = z.object({
  connections: z.array(connectionSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
});
const groupsSchema = z.object({
  data: z.object({
    groups: z.array(z.object({ id: z.string(), rule: z.enum(ASSISTANT_RULES).optional() })),
  }),
});
/** What this phone keeps: the connections as read, and the member's Groups when they were read. */
const savedSchema = z.object({ connections: pageSchema, groups: groupsSchema.nullable() });
type Saved = z.infer<typeof savedSchema>;

/** One Connected assistant as Account → Connected assistants lists it. */
export interface ListedAssistant {
  id: string;
  name: string;
  /** The host of its published address; null for an assistant that registered itself. */
  host: string | null;
  /** `Ledger`, or `Ledger + To review`: the server's words, which the screen labels. */
  access: string;
  lastUsedAt: string | null;
  /** How many of the member's Groups it reaches; null when they couldn't be read. */
  groups: { reached: number; of: number } | null;
}

export interface AssistantsState {
  /**
   * Whether the server has assistants switched on: Settings offers the screen only when true.
   * Null until a read or a Saved copy says.
   */
  available: boolean | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  assistants: ListedAssistant[] | null;
  /** When what's shown was read: by the server, or this phone's Saved copy (`saved`). */
  refreshedAt: number | null;
  saved: boolean;
  /** Splitbook couldn't be reached, and this phone keeps no copy. */
  unsaved: boolean;
  message: string;
  /** The assistant whose Disconnect sheet is open. */
  confirming: string | null;
  disconnecting: boolean;
  disconnectMessage: string;
  snackbar: string | null;
}

export const emptyAssistants = (): AssistantsState => ({
  available: null,
  status: 'idle',
  assistants: null,
  refreshedAt: null,
  saved: false,
  unsaved: false,
  message: '',
  confirming: null,
  disconnecting: false,
  disconnectMessage: '',
  snackbar: null,
});

export const refreshFailedAssistantsMessage =
  'Couldn’t refresh Connected assistants. Pull down to try again.';
export const notSavedAssistantsMessage =
  'Connected assistants aren’t saved on this phone. Connect to see them.';
export const disconnectNeedsConnection = 'Disconnecting needs a connection.';
export const disconnectFailedMessage = 'Couldn’t confirm the disconnection. Try again.';

/** A metadata document's host; a registered client's id is not an address. */
function host(clientId: string): string | null {
  try {
    const url = new URL(clientId);
    return url.protocol === 'https:' ? url.host : null;
  } catch {
    return null;
  }
}

function listed({ connections, groups }: Saved): ListedAssistant[] {
  return connections.connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    host: host(connection.clientId),
    access: connection.access,
    lastUsedAt: connection.lastUsedAt,
    groups: groups ? assistantGroupCount(groups.data.groups, connection.excludedGroupIds) : null,
  }));
}

/** What the screen needs from the controller that owns it. */
export interface AssistantsSession {
  /** The persister's rows; without them nothing is saved or restored. */
  rows?: AccountGroupRecordStore;
  generation(): number;
  current(owner: number): boolean;
  lease(): AccountStorageLease | null;
  /** The account lease's own checks, at write time: still this account, with no clean-up. */
  owns(accountId: string): boolean;
  /** Sends the read, checking the session first while offline. */
  read(path: string, owner: number): Promise<unknown>;
  send(path: string, owner: number, body: unknown): Promise<unknown>;
  /** Splitbook can be reached: a write may be sent. */
  online(): boolean;
  state(): AssistantsState;
  publish(next: AssistantsState): void;
  now(): number;
}

/**
 * Account → Connected assistants (#622): the same connection list and Disconnect as the web,
 * each assistant's Group count from the member's Groups, and a Saved copy for offline, written on
 * the saved-copy queue and cleared with the account's other saved copies.
 */
export function createAssistants(session: AssistantsSession) {
  const queue = createSavedCopyQueue();
  const update = (next: Partial<AssistantsState>) =>
    session.publish({ ...session.state(), ...next });

  const savedRow = async (lease: AccountStorageLease | null) => {
    const { rows } = session;
    if (!lease || !rows) return null;
    const row = cachedRead(
      await lease.write(() => rows.load(lease.accountId, assistantsPath)),
      lease.accountId,
      assistantsPath,
      session.now(),
    );
    const value = row && savedSchema.safeParse(row.value);
    return row && value?.success ? { refreshedAt: row.refreshedAt, value: value.data } : null;
  };
  /** Writes the answer as the Saved copy, checked at write time like every saved copy. */
  const save = (lease: AccountStorageLease | null, owner: number, value: Saved, at: number) => {
    const { rows } = session;
    if (!lease || !rows) return;
    queue.push(assistantsPath, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId)) return;
      const row = {
        version: 1,
        accountId: lease.accountId,
        path: assistantsPath,
        groupId: null,
        refreshedAt: at,
        value,
      };
      await rows.save(lease.accountId, assistantsPath, row).catch(() => undefined);
    });
  };
  /** The server has assistants switched off: nothing of them is kept. */
  const forget = (lease: AccountStorageLease | null, owner: number) => {
    const { rows } = session;
    if (!lease || !rows) return;
    queue.push(assistantsPath, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId)) return;
      await rows.remove(lease.accountId, assistantsPath).catch(() => undefined);
    });
  };
  const show = (value: Saved, refreshedAt: number, saved: boolean) =>
    update({
      available: true,
      status: 'ready',
      assistants: listed(value),
      refreshedAt,
      saved,
      unsaved: false,
      message: '',
    });

  /** Every page of the member's connections, as one. */
  const readConnections = async (owner: number) => {
    const connections: Saved['connections']['connections'] = [];
    let offset: number | null = 0;
    for (let page = 0; offset !== null && page < PAGES; page += 1) {
      const path: string = offset ? `${assistantsPath}?offset=${offset}` : assistantsPath;
      const read = pageSchema.parse(await session.read(path, owner));
      connections.push(...read.connections);
      offset = read.nextOffset;
    }
    return { connections, nextOffset: null };
  };

  /**
   * Reads the connections and the member's Groups. A 404 says the server has assistants
   * switched off; out of reach, this phone's Saved copy answers with its own time.
   */
  const read = async () => {
    const owner = session.generation(),
      lease = session.lease();
    update({ status: 'loading', message: '' });
    try {
      const connections = await readConnections(owner);
      let groups: Saved['groups'] = null;
      try {
        groups = groupsSchema.parse(await session.read(assistantGroupsPath, owner));
      } catch (error) {
        // Without the Groups, the list still shows, without its counts.
        if (error instanceof Superseded || !session.current(owner)) throw error;
      }
      if (!session.current(owner)) return;
      const at = session.now();
      show({ connections, groups }, at, false);
      save(lease, owner, { connections, groups }, at);
    } catch (error) {
      if (error instanceof Superseded || !session.current(owner)) return;
      if (error instanceof RequestError && error.status === 404) {
        update({ ...emptyAssistants(), available: false, status: 'ready' });
        forget(lease, owner);
        return;
      }
      if (error instanceof RequestError && error.networkFailure) {
        const row = await savedRow(lease).catch(() => null);
        if (!session.current(owner)) return;
        if (row) return show(row.value, row.refreshedAt, true);
        update({ status: 'ready', unsaved: true, message: notSavedAssistantsMessage });
        return;
      }
      update({ status: 'error', message: refreshFailedAssistantsMessage });
    }
  };

  /** Opens the Disconnect sheet for one of the assistants listed. */
  const ask = (id: string) => {
    const state = session.state();
    if (state.disconnecting || !state.assistants?.some((assistant) => assistant.id === id)) return;
    update({ confirming: id, disconnectMessage: '' });
  };
  const cancel = () => {
    if (!session.state().disconnecting) update({ confirming: null, disconnectMessage: '' });
  };

  /** Disconnects the assistant whose sheet is open; it needs a connection. */
  const disconnect = async () => {
    const state = session.state(),
      id = state.confirming;
    if (!id || state.disconnecting) return;
    if (!session.online()) return update({ disconnectMessage: disconnectNeedsConnection });
    const owner = session.generation();
    update({ disconnecting: true, disconnectMessage: '' });
    try {
      await session.send('/api/auth/mcp/revoke', owner, { id });
    } catch (error) {
      if (error instanceof Superseded || !session.current(owner)) return;
      return update({ disconnecting: false, disconnectMessage: disconnectFailedMessage });
    }
    if (!session.current(owner)) return;
    const shown = session.state().assistants ?? [];
    const name = shown.find((assistant) => assistant.id === id)?.name ?? 'The assistant';
    update({
      disconnecting: false,
      confirming: null,
      assistants: shown.filter((assistant) => assistant.id !== id),
      snackbar: `${name} disconnected`,
    });
    // The Saved copy follows what the server now lists.
    await read();
  };

  return {
    read,
    ask,
    cancel,
    disconnect,
    dismiss: () => update({ snackbar: null }),
    /** Settles once no Saved copy is being written. */
    idle: () => queue.idle(),
    /** The session ended: nothing waiting is written. */
    reset: () => queue.cancel(),
  };
}
