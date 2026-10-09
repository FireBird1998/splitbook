import { memo } from 'react';
import { CompactText } from './compact';

/** One local day, rather than a changing millisecond timestamp, for relative list labels. */
export const currentDayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const ListDayHeader = memo(function ListDayHeader({ label }: { label: string }) {
  return (
    <CompactText
      variant="small"
      tone="secondary"
      accessibilityRole="header"
      style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}
    >
      {label}
    </CompactText>
  );
});
