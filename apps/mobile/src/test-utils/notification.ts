import type { MobileDependencies } from '../data/types';

const binding = '00000000-0000-4000-8000-000000000001';
const activation = '00000000-0000-4000-8000-000000000002';
export const notificationDevice: NonNullable<MobileDependencies['notifications']> = {
  installation: async () => ({ id: binding, key: 'private-installation-proof-840840840' }),
  permission: async () => 'granted',
  requestPermission: async () => 'granted',
  token: async () => 'private-token',
  clear: async () => {},
  openSettings: async () => {},
};
export const notificationPreferences = {
  available: true,
  enabled: true,
  expenseUpdates: true,
  payments: true,
  revision: 1,
  binding,
  activation,
  expenseCutoff: new Date(0).toISOString(),
  paymentCutoff: new Date(0).toISOString(),
};
export function notificationHint(accountId: string, groupId: string, now: number) {
  return {
    version: 2,
    eventId: 'd00000000000000000000001',
    kind: 'expense_added',
    groupId,
    recordId: 'c00000000000000000000001',
    accountId,
    environment: 'development',
    binding,
    activation,
    occurredAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now - 1_000 + 86_400_000).toISOString(),
  };
}
