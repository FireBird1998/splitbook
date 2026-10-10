import type { ExpenseEditor } from './expense-draft';
import type { SettlementState } from './settlement';
import type { GroupCreation, LeaveGroupState } from './types';

type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

// These describe the hand-written flows. Only tests enforce them; the controller remains
// their sole owner. Resets on navigation, sign-out and access loss are declared too.
export const expenseTransitions = {
  idle: ['loading', 'editing', 'resume', 'blocked'],
  loading: [
    'idle',
    'editing',
    'resume',
    'detail',
    'delete-review',
    'blocked',
    'conflict',
    'saved',
    'uncertain',
  ],
  editing: ['idle', 'loading', 'resume', 'detail', 'saving', 'uncertain', 'blocked'],
  resume: ['idle', 'loading', 'editing', 'detail', 'uncertain', 'blocked', 'saving'],
  detail: ['idle', 'loading', 'editing', 'resume', 'blocked', 'delete-review'],
  'delete-review': ['idle', 'loading', 'detail', 'saving', 'blocked'],
  saving: [
    'idle',
    'loading',
    'editing',
    'detail',
    'delete-review',
    'saved',
    'uncertain',
    'blocked',
    'conflict',
  ],
  uncertain: [
    'idle',
    'loading',
    'editing',
    'resume',
    'saving',
    'saved',
    'detail',
    'blocked',
    'conflict',
  ],
  saved: ['idle', 'loading', 'editing', 'resume', 'blocked'],
  blocked: ['idle', 'loading', 'editing', 'resume', 'detail', 'uncertain'],
  conflict: ['idle', 'loading', 'editing', 'resume', 'detail', 'blocked'],
} as const satisfies Transitions<ExpenseEditor['status']>;

export const settlementTransitions = {
  idle: ['loading', 'blocked'],
  loading: ['idle', 'ready', 'uncertain', 'blocked', 'error'],
  ready: ['idle', 'loading', 'editing', 'blocked'],
  editing: ['idle', 'loading', 'ready', 'review', 'saving', 'blocked'],
  review: ['idle', 'loading', 'ready', 'editing', 'saving', 'blocked'],
  saving: ['idle', 'ready', 'editing', 'review', 'uncertain', 'blocked'],
  uncertain: ['idle', 'loading', 'ready', 'saving', 'blocked'],
  blocked: ['idle', 'loading', 'ready', 'error'],
  error: ['idle', 'loading', 'blocked'],
} as const satisfies Transitions<SettlementState['status']>;

export const creationTransitions = {
  editing: ['saving', 'error', 'uncertain'],
  saving: ['editing', 'error', 'uncertain'],
  error: ['editing', 'saving', 'uncertain'],
  uncertain: ['editing', 'saving'],
} as const satisfies Transitions<GroupCreation['status']>;

export const leaveTransitions = {
  closed: ['checking'],
  checking: ['closed', 'confirm', 'blocked'],
  confirm: ['closed', 'checking', 'leaving'],
  leaving: ['closed', 'blocked', 'refused', 'error'],
  blocked: ['closed', 'checking'],
  refused: ['closed', 'checking', 'leaving'],
  error: ['closed', 'checking', 'leaving'],
} as const satisfies Transitions<LeaveGroupState['status']>;
