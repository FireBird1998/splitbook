import type { MobileSnapshot } from '../data/types';
import { Copy, Label, Panel } from './primitives';
import { useTheme } from './theme';

export function OfflineNotice({ state }: { state: MobileSnapshot['offline'] }) {
  const theme = useTheme();
  if (!state.active && !state.message) return null;
  return (
    <Panel>
      <Label>{state.active ? 'OFFLINE OR PARTLY CONNECTED · SAVED DATA' : 'OFFLINE STORAGE'}</Label>
      {state.active ? (
        <>
          <Copy>Saved views may be out of date. Connect to refresh data and verify access.</Copy>
          <Copy style={{ color: theme.textSecondary }}>
            {state.refreshedAt === null
              ? 'This view has no saved refresh time.'
              : `Oldest saved view shown: ${new Date(state.refreshedAt).toLocaleString()}`}
          </Copy>
          <Copy>
            You can prepare a draft. Saving and recording payments need a connection; reconnecting
            never sends them automatically.
          </Copy>
        </>
      ) : null}
      {state.message ? <Copy accessibilityRole="alert">{state.message}</Copy> : null}
    </Panel>
  );
}
