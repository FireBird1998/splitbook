import { CancelledError, type QueryClient } from '@tanstack/query-core';
import { z } from 'zod';
import { assistantGroupsPath, connectedAssistantsPath } from '@splitbook/shared/api-paths';
import { ASSISTANT_RULES } from '@splitbook/shared/assistant-rule';
import { assistantGroupCount } from '@splitbook/shared/connected-assistant';
import {
  connectedAssistantsKey,
  type QueryAccount,
  type QueryKey,
} from '@splitbook/shared/query-keys';
import type { AccountGroupRecordStore } from './account-record-storage';
import { createSavedCopyQueue } from './home-queries';
import { cachedRead } from './offline-cache';
import { queryOwner } from './query-owner';
import { RequestError, Superseded } from './transport';
import type { AccountStorageLease } from './types';

/** The member's Connected assistants, as Settings on the web reads them (#615, #620). */
export const assistantsPath = connectedAssistantsPath();
/** The most pages of connections read at once: 25 each, far more than a member connects. */
const MAX_PAGES = 20;

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
/** The query's answer: from the server, or this phone's Saved copy with its own time. */
type Answer = { source: 'network' | 'saved'; refreshedAt: number; value: Saved };

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
  client: QueryClient;
  /** The signed-in account in this environment; throws `Superseded` when there is none. */
  account(): QueryAccount;
  /** The persister's rows; without them nothing is saved or restored. */
  rows?: AccountGroupRecordStore;
  generation(): number;
  current(owner: number): boolean;
  lease(): AccountStorageLease | null;
  /** The account lease's own checks, at write time: still this account, with no clean-up. */
  owns(accountId: string): boolean;
  /** Sends the read, checking the session first while offline. */
  read(path: string, owner: number, signal?: AbortSignal): Promise<unknown>;
  send(path: string, owner: number, body: unknown): Promise<unknown>;
  /** Splitbook can be reached: a write may be sent. */
  online(): boolean;
  /** A Saved copy of `key` stands in for a read only when verified after this. */
  distrusted(key: QueryKey, early: boolean): number;
  /** This account's Saved copies in these scopes couldn't be removed: never shown again. */
  distrust(accountId: string, scopes: string[]): void;
  state(): AssistantsState;
  publish(next: AssistantsState): void;
  now(): number;
}

/**
 * Account → Connected assistants (#622): the same connection list and Disconnect as the web,
 * each assistant's Group count from the member's Groups, and a Saved copy for offline. The read
 * is a TanStack query (ADR 0006): reads join it, a Disconnect cancels it, and its Saved copy is
 * written on the saved-copy queue, checked at write time, and cleared with the account's others.
 */
export function createAssistants(session: AssistantsSession) {
  const queue = createSavedCopyQueue();
  const update = (next: Partial<AssistantsState>) =>
    session.publish({ ...session.state(), ...next });

  /** This phone's Saved copy, unless one it couldn't remove makes it untrusted. */
  const savedRow = async (lease: AccountStorageLease | null, key: QueryKey) => {
    const { rows } = session;
    if (!lease || !rows) return null;
    const row = cachedRead(
      await lease.write(() => rows.load(lease.accountId, assistantsPath)),
      lease.accountId,
      assistantsPath,
      session.now(),
    );
    const value = row && savedSchema.safeParse(row.value);
    return row && value?.success && row.refreshedAt > session.distrusted(key, false)
      ? { refreshedAt: row.refreshedAt, value: value.data }
      : null;
  };
  /**
   * A write of the Saved copy on the saved-copy queue, where the latest for it wins. The session,
   * the account and the read's own query (`owns`) are checked at write time, so nothing lands
   * after sign-out, an account change or a Disconnect that made the read obsolete.
   */
  const queueWrite = (
    lease: AccountStorageLease | null,
    owner: number,
    owns: () => boolean,
    write: (rows: AccountGroupRecordStore, accountId: string) => Promise<void>,
  ) => {
    const { rows } = session;
    if (!lease || !rows) return;
    queue.push(assistantsPath, async () => {
      if (!session.current(owner) || !session.owns(lease.accountId) || !owns()) return;
      await write(rows, lease.accountId).catch(() => undefined);
    });
  };
  const show = (answer: Answer) => {
    const assistants = listed(answer.value),
      { confirming } = session.state();
    update({
      available: true,
      status: 'ready',
      assistants,
      refreshedAt: answer.refreshedAt,
      saved: answer.source === 'saved',
      unsaved: false,
      message: '',
      // A sheet open for an assistant no longer listed closes, as it can't be disconnected again.
      ...(confirming && !assistants.some(({ id }) => id === confirming)
        ? { confirming: null, disconnectMessage: '' }
        : {}),
    });
  };

  /** Every page of the member's connections, as one. */
  const readConnections = async (owner: number, signal: AbortSignal) => {
    const connections: Saved['connections']['connections'] = [];
    let offset: number | null = 0;
    for (let page = 0; offset !== null && page < MAX_PAGES; page += 1) {
      const path: string = offset ? `${assistantsPath}?offset=${offset}` : assistantsPath;
      const read = pageSchema.parse(await session.read(path, owner, signal));
      connections.push(...read.connections);
      offset = read.nextOffset;
    }
    return { connections, nextOffset: null };
  };

  /**
   * The query's read: the connections and the member's Groups. Out of reach, this phone's Saved
   * copy answers with its own time; with none, it says so.
   */
  const fetchAssistants = async (key: QueryKey, owner: number, signal: AbortSignal) => {
    const lease = session.lease(),
      owns = queryOwner(session.client, key);
    let value: Saved;
    try {
      const connections = await readConnections(owner, signal);
      let groups: Saved['groups'] = null;
      try {
        groups = groupsSchema.parse(await session.read(assistantGroupsPath(), owner, signal));
      } catch (error) {
        // Without the Groups, the list still shows, without its counts.
        if (error instanceof Superseded || signal.aborted || !session.current(owner)) throw error;
      }
      value = { connections, groups };
    } catch (error) {
      if (!(error instanceof RequestError) || !error.networkFailure) throw error;
      const row = await savedRow(lease, key).catch(() => null);
      if (!session.current(owner) || !owns()) throw new Superseded();
      if (!row)
        throw new RequestError(
          notSavedAssistantsMessage,
          0,
          'OFFLINE_UNAVAILABLE',
          false,
          null,
          'network',
        );
      return { source: 'saved', ...row } satisfies Answer;
    }
    if (!session.current(owner) || !owns()) throw new Superseded();
    const refreshedAt = session.now();
    queueWrite(lease, owner, owns, (rows, accountId) =>
      rows.save(accountId, assistantsPath, {
        version: 1,
        accountId,
        path: assistantsPath,
        groupId: null,
        refreshedAt,
        value,
      }),
    );
    return { source: 'network', refreshedAt, value } satisfies Answer;
  };

  /**
   * Reads the connections through their query, which a read already under way joins. A 404 says
   * the server has assistants switched off.
   */
  const read = async () => {
    const owner = session.generation();
    let key: QueryKey;
    try {
      key = connectedAssistantsKey(session.account());
    } catch {
      return;
    }
    update({ status: 'loading', message: '' });
    try {
      const answer = await session.client.fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => fetchAssistants(key, owner, signal),
        staleTime: 0,
        retry: false,
      });
      if (session.current(owner)) show(answer);
    } catch (error) {
      // Cancelled by a Disconnect, or a session that ended: the read that replaced it shows.
      if (error instanceof CancelledError || error instanceof Superseded) return;
      if (!session.current(owner)) return;
      if (error instanceof RequestError && error.status === 404) {
        update({ ...emptyAssistants(), available: false, status: 'ready' });
        const lease = session.lease();
        queueWrite(lease, owner, queryOwner(session.client, key), (rows, accountId) =>
          rows.remove(accountId, assistantsPath),
        );
        return;
      }
      // Nothing of the list shows beside "not saved on this phone", not even what was read before.
      if (error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE')
        return update({
          status: 'ready',
          assistants: null,
          refreshedAt: null,
          saved: false,
          unsaved: true,
          message: notSavedAssistantsMessage,
        });
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

  /**
   * Nothing read before a Disconnect shows or is saved after it: its query is cancelled and
   * removed, and the Saved copy goes before the Disconnect is sent. A copy this phone couldn't
   * remove is never shown again.
   */
  const forgetBefore = async (owner: number) => {
    const key = connectedAssistantsKey(session.account()),
      lease = session.lease(),
      { client, rows } = session;
    await client.cancelQueries({ queryKey: key, exact: true });
    client.removeQueries({ queryKey: key, exact: true });
    queue.drop(assistantsPath);
    await queue.idle();
    if (!lease || !rows || !session.current(owner)) return;
    await rows
      .remove(lease.accountId, assistantsPath)
      .catch(() => session.distrust(lease.accountId, [key[0]]));
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
      await forgetBefore(owner);
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
    // Read again: the server's list now, and its Saved copy.
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
