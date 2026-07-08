interface BuildDuplicateCheckUrlInput {
  groupId: string;
  description: string;
  amount: number;
  date: string;
  excludeId?: string;
}

export function buildDuplicateCheckUrl({
  groupId,
  description,
  amount,
  date,
  excludeId,
}: BuildDuplicateCheckUrlInput) {
  const params = new URLSearchParams({
    description,
    amount: String(amount),
    date,
  });

  if (excludeId) {
    params.set('excludeId', excludeId);
  }

  return `/api/groups/${groupId}/expenses/check-duplicate?${params.toString()}`;
}
