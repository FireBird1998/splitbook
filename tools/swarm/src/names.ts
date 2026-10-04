/**
 * The database names the tool creates, and the one check every drop goes through.
 */
import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { Refused, type MongoFailed } from './platform.ts';

/** Every database the tool creates starts with this, inside #185's splitbook_mobile_ rule. */
export const toolPrefix = 'splitbook_mobile_swarm_';

/**
 * The fictional backend's ownership marker (apps/mobile/scripts/dev-backend/environment.mjs).
 * Its seed writes it first; a test keeps the two in step.
 */
export const fictionalMarker = 'splitbook-native-ticket-50-fictional-only';

/** This worktree's databases start with this: the tool prefix and a hash of the worktree path. */
export function worktreePrefix(root: string): string {
  return `${toolPrefix}${createHash('sha256').update(root).digest('hex').slice(0, 10)}_`;
}

const worktreePrefixShape = /^splitbook_mobile_swarm_[0-9a-f]{10}_$/;

/** Why a database may not be dropped for this worktree, judged by its name alone. */
export function dropNameRefusal(name: string, prefix: string): string | undefined {
  if (!worktreePrefixShape.test(prefix)) {
    return `Refusing to drop ${name}: ${prefix} is not a worktree prefix (${toolPrefix} and a 10-character hash).`;
  }
  if (!name.startsWith(prefix) || name.length === prefix.length) {
    return `Refusing to drop ${name}: only this worktree's databases, whose names start with ${prefix}, are dropped.`;
  }
  if (name.length > 63 || !/^[a-z0-9_]+$/.test(name)) {
    return `Refusing to drop ${name}: the tool never creates a name like it.`;
  }
  return undefined;
}

/** What a drop needs from one database. */
export interface DatabaseHandle {
  readonly exists: () => Promise<boolean>;
  /** Whether it holds the fictional ownership marker. */
  readonly isFictional: () => Promise<boolean>;
  readonly drop: () => Promise<void>;
}

/**
 * Drops a database only when its name starts with this worktree's prefix and it holds the
 * fictional ownership marker. The name is checked before anything connects.
 */
export const guardedDrop = (
  name: string,
  prefix: string,
  withDatabase: <A>(use: (database: DatabaseHandle) => Promise<A>) => Effect.Effect<A, MongoFailed>,
): Effect.Effect<'dropped' | 'absent', MongoFailed | Refused> => {
  const refusal = dropNameRefusal(name, prefix);
  if (refusal) return Effect.fail(new Refused({ message: refusal }));
  return withDatabase(async (database) => {
    if (!(await database.exists())) return 'absent' as const;
    if (!(await database.isFictional())) return 'unmarked' as const;
    await database.drop();
    return 'dropped' as const;
  }).pipe(
    Effect.flatMap((result) =>
      result === 'unmarked'
        ? Effect.fail(
            new Refused({
              message: `Refusing to drop ${name}: it has no fictional ownership marker, so the tool did not create it.`,
            }),
          )
        : Effect.succeed(result),
    ),
  );
};
