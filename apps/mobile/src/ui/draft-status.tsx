import { useEffect, useState } from 'react';
import { type ExpenseEditor as Editor } from '../data/expense-draft';
import { View } from 'react-native';
import { CompactText } from './compact';
import { Icon } from './primitives';
import { useTheme } from './theme';
/** "Draft saved" while this device keeps entries that differ from where the form started. */
export function DraftStatus({
  persistence,
  kept,
}: {
  persistence: Editor['persistence'];
  kept: boolean;
}) {
  const theme = useTheme();
  // Writes run on every keystroke; only one that takes a while says so.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (persistence !== 'saving') return;
    const timer = setTimeout(() => setSlow(true), 400);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [persistence]);
  const saving = persistence === 'saving' && slow;
  if (persistence !== 'error' && !saving && (persistence !== 'saved' || !kept)) return null;
  const [icon, text, color] =
    persistence === 'error'
      ? (['alert-circle-outline', 'Draft not saved', theme.status.negative] as const)
      : saving
        ? (['sync-outline', 'Saving draft…', theme.textSecondary] as const)
        : (['checkmark', 'Draft saved', theme.textSecondary] as const);
  return (
    <View
      accessible
      accessibilityLabel={text}
      // Only a failure is announced.
      accessibilityLiveRegion={persistence === 'error' ? 'polite' : 'none'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}
    >
      <Icon name={icon} size={16} color={color} />
      <CompactText variant="caption" style={{ color }}>
        {text}
      </CompactText>
    </View>
  );
}
