/**
 * Either party in a debt can record the settlement (payer or recipient).
 * Pure helper shared by server services and client components.
 */
export function canRecordSettlement(actorId: string, paidBy: string, paidTo: string): boolean {
  return actorId === paidBy || actorId === paidTo;
}
