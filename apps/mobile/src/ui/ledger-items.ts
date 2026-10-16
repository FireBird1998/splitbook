/** A day heading and its rows, each with an identity independent of its position. */
export type LedgerItem<Row> = (
  | { kind: 'day'; key: string; label: string }
  | { kind: 'row'; key: string; row: Row }
) & { first: boolean; last: boolean };

export function ledgerItems<Row>(
  days: ReadonlyArray<{ key: string; label: string; rows: readonly Row[] }>,
  key: (row: Row) => string,
): LedgerItem<Row>[] {
  const items: LedgerItem<Row>[] = [];
  for (const day of days) {
    items.push({ kind: 'day', key: `day:${day.key}`, label: day.label, first: false, last: false });
    for (const row of day.rows)
      items.push({ kind: 'row', key: key(row), row, first: false, last: false });
  }
  if (items.length) {
    items[0].first = true;
    items[items.length - 1].last = true;
  }
  return items;
}
