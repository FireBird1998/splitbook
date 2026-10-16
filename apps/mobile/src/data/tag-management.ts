import { z } from 'zod';
import {
  tagActionResultSchema,
  isDefinitiveTagRejection,
  tagCommandSchema,
  tagSnapshotSchema,
  type TagActionResult,
  type TagCommand,
  type TagIntent,
} from '@splitbook/shared/tag-management';
import { RequestError } from './transport';

export type MobileTagIntent = Exclude<TagIntent, { action: 'delete' }>;
const recordSchema = z
  .object({
    command: tagCommandSchema,
    confirmed: tagActionResultSchema.optional(),
    rejected: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  .refine((record) => record.command.intent.action !== 'delete');
export type TagRecovery = z.infer<typeof recordSchema>;
const data = (value: unknown) => z.object({ data: z.unknown() }).parse(value).data;

/** Durable exact intent, independent of the manager view. No read ever sends a write. */
export function tagManagement({
  load,
  save,
  remove,
  read,
  send,
  check,
  key,
  current,
  online,
  busy,
}: {
  load(): Promise<unknown>;
  save(record: TagRecovery): Promise<void>;
  remove(): Promise<void>;
  read(): Promise<unknown>;
  send(command: TagCommand): Promise<unknown>;
  check(requestId: string): Promise<unknown>;
  key(): string;
  current(): void;
  online(): void;
  busy: { active: boolean };
}) {
  const recovery = async () => {
    current();
    try {
      const value = await load();
      current();
      return value === null ? null : recordSchema.parse(value);
    } catch {
      current();
      throw new Error(
        'This device’s Tag recovery information could not be read. Restart to try again; nothing was sent.',
      );
    }
  };
  const result = async (value: unknown, record: TagRecovery) => {
    current();
    const parsed = tagActionResultSchema.parse(data(value));
    if (parsed.requestId !== record.command.requestId)
      throw new Error(
        'The server returned a different Tag action. Check the original action again.',
      );
    if (parsed.state === 'applied') {
      if (JSON.stringify(parsed.receipt.intent) !== JSON.stringify(record.command.intent))
        throw new Error(
          'The server returned a different Tag action. Check the original action again.',
        );
      try {
        await save({ command: record.command, confirmed: parsed });
      } catch {
        current();
        throw new Error(
          'The Tag action was confirmed, but this device could not keep its receipt. Check the original action again.',
        );
      }
    }
    current();
    return parsed;
  };
  const post = async (record: TagRecovery): Promise<TagActionResult> => {
    online();
    try {
      return await result(await send(record.command), record);
    } catch (error) {
      current();
      // The server rejected this exact intent. Permission loss or an absent receipt on a GET
      // cannot prove that an earlier POST did not apply, so neither makes it discardable.
      if (error instanceof RequestError && isDefinitiveTagRejection(error.status, error.code))
        await save({
          command: record.command,
          rejected: { code: error.code!, message: error.serverMessage ?? error.message },
        });
      throw error;
    }
  };
  const run = async <T>(operation: () => Promise<T>) => {
    online();
    if (busy.active) throw new Error('A Tag action is still being checked. Wait for its reply.');
    busy.active = true;
    try {
      return await operation();
    } finally {
      busy.active = false;
    }
  };
  return {
    recovery,
    pending: async () => (await recovery())?.command ?? null,
    read: async () => {
      online();
      const snapshot = tagSnapshotSchema.parse(data(await read()));
      current();
      return snapshot;
    },
    submit: (intent: MobileTagIntent) =>
      run(async () => {
        if (await recovery())
          throw new Error('Resolve the previous Tag action before starting another.');
        const command = tagCommandSchema.parse({ requestId: key(), intent });
        if (command.intent.action === 'delete')
          throw new Error('Deleting Tags is not available here.');
        try {
          await save({ command });
        } catch {
          current();
          throw new Error(
            'This device could not keep a recovery copy, so nothing was sent. Your Tag name is kept. Try again.',
          );
        }
        current();
        return post({ command });
      }),
    check: () =>
      run(async () => {
        online();
        const record = await recovery();
        if (!record) throw new Error('There is no Tag action to check.');
        return result(await check(record.command.requestId), record);
      }),
    retry: () =>
      run(async () => {
        const record = await recovery();
        if (!record) throw new Error('There is no Tag action to retry.');
        return post(record);
      }),
    acknowledge: async () => {
      current();
      if (busy.active) throw new Error('Wait for the Tag action to finish before continuing.');
      busy.active = true;
      try {
        const record = await recovery();
        if (record && record.confirmed?.state !== 'applied' && !record.rejected)
          throw new Error('This Tag action is not confirmed. Check or retry the original action.');
        await remove();
      } finally {
        busy.active = false;
      }
    },
  };
}
