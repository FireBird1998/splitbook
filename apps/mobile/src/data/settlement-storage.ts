import { createAccountGroupRecordStore } from './account-record-storage';

export const createSettlementAttemptStore = (environment: string) =>
  createAccountGroupRecordStore(environment, 'settlement');
