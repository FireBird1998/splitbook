/**
 * Pure helpers for trip-focused group creation.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTripDates(
  startDate?: string | Date | null,
  endDate?: string | Date | null,
): string | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Trip dates are invalid';
  }
  if (start > end) {
    return 'End date must be on or after start date';
  }
  return null;
}

export function normalizeParticipantEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }

  return result;
}

export function isValidParticipantEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim().toLowerCase());
}

export interface TripChecklistItem {
  id: 'invite' | 'expense' | 'settle';
  title: string;
  description: string;
  done: boolean;
  actionLabel: string;
}

export function buildTripChecklist(input: {
  memberCount: number;
  expenseCount: number;
  outstandingDebtCount: number;
}): TripChecklistItem[] {
  return [
    {
      id: 'invite',
      title: 'Invite your friends',
      description: 'Trips work best with the whole crew.',
      done: input.memberCount > 1,
      actionLabel: 'Invite',
    },
    {
      id: 'expense',
      title: 'Add the first expense',
      description: 'Capture a shared cost so balances appear.',
      done: input.expenseCount > 0,
      actionLabel: 'Add expense',
    },
    {
      id: 'settle',
      title: 'Settle when ready',
      description: 'Record who paid whom after the trip.',
      done: input.expenseCount > 0 && input.outstandingDebtCount === 0,
      actionLabel: 'View balances',
    },
  ];
}

export function shouldShowTripChecklist(items: TripChecklistItem[]): boolean {
  return items.some((item) => !item.done);
}
