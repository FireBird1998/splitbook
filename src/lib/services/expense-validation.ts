type Participant = {
  user: unknown;
};

export function assertExpenseParticipants(
  memberIds: Set<string>,
  paidBy: Participant[],
  splitBetween: Participant[],
): void {
  const hasInvalidParticipant = [...paidBy, ...splitBetween].some(
    (participant) => !memberIds.has(String(participant.user)),
  );

  if (hasInvalidParticipant) {
    throw new Error('INVALID_MEMBERS');
  }
}

export function assertActiveTag(activeTagNames: Set<string>, tag: string): void {
  if (!activeTagNames.has(tag)) {
    throw new Error('INVALID_TAG');
  }
}

export function assertGroupCurrency(defaultCurrency: string, currency: string): void {
  if (currency !== defaultCurrency) {
    throw new Error('CURRENCY_MISMATCH');
  }
}
