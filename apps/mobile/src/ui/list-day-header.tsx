import { memo } from 'react';
import { CompactText } from './compact';

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
