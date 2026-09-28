import { createAccountGroupRecordStore } from './account-record-storage';

export const createExpenseDraftStore = (environment: string) =>
  createAccountGroupRecordStore(environment, 'expense');
