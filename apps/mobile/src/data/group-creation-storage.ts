import { createAccountGroupRecordStore } from './account-record-storage';
import type { GroupCreationStore } from './types';

/** The Group doesn't exist yet, so each account's one submission has a fixed row. */
const slot = 'new-group';

export function createGroupCreationStore(environment: string): GroupCreationStore {
  const records = createAccountGroupRecordStore(environment, 'group-creation');
  return {
    load: (accountId) => records.load(accountId, slot),
    save: (accountId, value) => records.save(accountId, slot, value),
    remove: (accountId) => records.remove(accountId, slot),
    clear: () => records.clear(),
  };
}
