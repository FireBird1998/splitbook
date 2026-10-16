import { tagCommandSchema, type TagCommand } from '@splitbook/shared/tag-management';

const PREFIX = 'splitbook:tag-action:v1:';
export interface TagActionScope {
  accountId: string;
  groupId: string;
}
type Cleanup = { accountId: string; groupId: string } | { except?: string };
const cleanupListeners = new Set<(cleanup: Cleanup) => void>();
const scopeKey = ({ accountId, groupId }: TagActionScope) =>
  `${PREFIX}${encodeURIComponent(window.location.origin)}:${accountId}:${groupId}:`;

/** One entry per immutable command: another tab cannot replace an interrupted action. */
export function retainTagAction(scope: TagActionScope, command: TagCommand): string {
  const body = JSON.stringify(tagCommandSchema.parse(command));
  const key = `${scopeKey(scope)}${command.requestId}`;
  window.localStorage.setItem(key, body);
  if (window.localStorage.getItem(key) !== body)
    throw new Error('Tag action could not be retained');
  return body;
}

export function forgetTagAction(scope: TagActionScope, requestId: string) {
  window.localStorage.removeItem(`${scopeKey(scope)}${requestId}`);
}

export function hasRetainedTagAction(scope: TagActionScope, action: RetainedTagAction): boolean {
  return (
    window.localStorage.getItem(`${scopeKey(scope)}${action.command.requestId}`) === action.body
  );
}

export interface RetainedTagAction {
  command: TagCommand;
  body: string;
}
export function readTagActions(scope: TagActionScope): RetainedTagAction[] {
  const storage = window.localStorage;
  const prefix = scopeKey(scope);
  const actions: RetainedTagAction[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const body = storage.getItem(key);
    if (!body) throw new Error('A retained Tag action could not be read');
    const command = tagCommandSchema.parse(JSON.parse(body));
    if (key !== `${prefix}${command.requestId}`) throw new Error('Invalid retained Tag action');
    actions.push({ command, body });
  }
  return actions;
}

/** The same sign-out/account-switch and denied-Group lifecycle as financial recovery. */
function forget(cleanup: Cleanup) {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) {
      if (!key?.startsWith(PREFIX)) continue;
      const [, accountId, groupId] = key.slice(PREFIX.length).split(':');
      const remove =
        'groupId' in cleanup
          ? accountId === cleanup.accountId && groupId === cleanup.groupId
          : !cleanup.except || accountId !== cleanup.except;
      if (remove) storage.removeItem(key);
    }
  } catch {
    // A refused store must not keep inaccessible data on screen either.
  }
  for (const listener of cleanupListeners) listener(cleanup);
}

export function forgetBrowserTagActions(options: { except?: string } = {}) {
  forget(options);
}
export function forgetBrowserGroupTagActions(accountId: string, groupId: string) {
  forget({ accountId, groupId });
}

export function subscribeTagActionCleanup(scope: TagActionScope, listener: () => void) {
  const onCleanup = (cleanup: Cleanup) => {
    if (
      'groupId' in cleanup
        ? cleanup.accountId === scope.accountId && cleanup.groupId === scope.groupId
        : cleanup.except !== scope.accountId
    )
      listener();
  };
  cleanupListeners.add(onCleanup);
  return () => {
    cleanupListeners.delete(onCleanup);
  };
}

export function subscribeTagActionStorage(scope: TagActionScope, listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(scopeKey(scope))) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
