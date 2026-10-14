/** "Maple House", "Maple House and Goa Trip", or "Maple House, Goa Trip and Flat 4B". */
export function joinGroupNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The end-of-run line, singular for one item. */
export function reviewedItemsLine(count: number, groupNames: readonly string[]): string {
  return `You went through ${count} ${count === 1 ? 'item' : 'items'} in ${joinGroupNames(groupNames)}`;
}
