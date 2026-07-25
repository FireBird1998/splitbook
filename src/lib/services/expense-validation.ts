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

export function shouldValidateExpenseTag(
  incomingTag: string | undefined,
  existingTag: string,
): boolean {
  return incomingTag !== undefined && incomingTag !== existingTag;
}

export function assertActiveTag(activeTagNames: Set<string>, tag: string): void {
  if (!activeTagNames.has(tag)) {
    throw new Error('INVALID_TAG');
  }
}

export function assertSettlementMembers(
  memberIds: Set<string>,
  paidBy: string,
  paidTo: string,
): void {
  if (!memberIds.has(paidBy) || !memberIds.has(paidTo)) {
    throw new Error('INVALID_MEMBERS');
  }
  if (paidBy === paidTo) {
    throw new Error('SAME_PARTY');
  }
}

/**
 * Either party in a debt can record the settlement (payer or recipient).
 */
export function canRecordSettlement(
  actorId: string,
  paidBy: string,
  paidTo: string,
): boolean {
  return actorId === paidBy || actorId === paidTo;
}

export function assertSettlementAuthorization(
  actorId: string,
  paidBy: string,
  paidTo: string,
): void {
  if (!canRecordSettlement(actorId, paidBy, paidTo)) {
    throw new Error('FORBIDDEN_SETTLEMENT');
  }
}

export function assertGroupCurrency(defaultCurrency: string, currency: string): void {
  if (currency !== defaultCurrency) {
    throw new Error('CURRENCY_MISMATCH');
  }
}
