import type { AllowedRefusalSite } from './refusal-contract.ts';

// Reviewed retained faults and assistant-protocol sites. A missing or moved site fails the check.
export const refusalExceptions = [
  {
    path: 'apps/web/src/lib/financial-write.ts',
    code: 'INVALID_REQUEST_FINGERPRINT',
    when: "typeof value === 'number' && !Number.isFinite(value)",
    within: 'canonicalize',
    reason: 'Trusted command fingerprints require finite JSON-compatible values.',
  },
  {
    path: 'apps/web/src/lib/financial-write.ts',
    code: 'INVALID_REQUEST_FINGERPRINT',
    when: "['function', 'symbol', 'bigint'].includes(typeof value)",
    within: 'canonicalize',
    reason: 'Trusted command fingerprints require finite JSON-compatible values.',
  },
  {
    path: 'apps/web/src/lib/services/assistant-ledger.service.ts',
    code: 'GROUP_NOT_FOUND',
    when: '!group',
    within: 'requireLedgerMembership',
    reason:
      'Assistant protocol hides missing and excluded Groups alike. Its HTTP fallthrough stays a fault until the owner decides #1086.',
  },
  {
    path: 'apps/web/src/lib/services/assistant-ledger.service.ts',
    code: 'GROUP_NOT_FOUND',
    when: '!read',
    within: 'balances',
    reason:
      'Assistant protocol hides missing and excluded Groups alike. Its HTTP fallthrough stays a fault until the owner decides #1086.',
  },
  {
    path: 'apps/web/src/lib/services/expense-draft.service.ts',
    code: 'GROUP_NOT_FOUND',
    when: 'reach',
    within: 'requireMembership',
    reason:
      'Assistant protocol hides missing and excluded Groups alike. Its HTTP fallthrough stays a fault until the owner decides #1086.',
  },
  {
    path: 'apps/web/src/lib/services/export.service.ts',
    code: 'BACKUP_ALL_TIME',
    when: 'request.from || request.to',
    within: 'buildBackupFile',
    reason:
      'The trusted backup command must cover all time. This fault is retained for the owner in #1086.',
  },
  {
    path: 'apps/web/src/lib/ledger-recording.ts',
    code: 'IDEMPOTENCY_CONFLICT',
    when: '!first.batchSettlementIds?.length',
    within: 'recordLedger',
    reason: 'A matching committed batch receipt must contain its atomically stored batch IDs.',
  },
  {
    path: 'apps/web/src/lib/services/settlement.service.ts',
    code: 'INVALID_MONEY',
    when: 'amountMinor <= 0',
    within: 'create',
    reason: 'An admitted Settlement already passed positive-amount and exact-money validation.',
  },
  {
    path: 'packages/shared/src/currency.ts',
    code: 'INVALID_CURRENCY',
    when: '!CURRENCY_CODES.includes(code)',
    within: 'getCurrencyPrecision',
    reason:
      'Preserve the existing currency lookup or stored-data fault, separately from the query refusal, for #1086.',
  },
] satisfies readonly AllowedRefusalSite[];
