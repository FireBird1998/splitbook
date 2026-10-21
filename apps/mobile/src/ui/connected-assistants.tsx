import { useMemo } from 'react';
import { View } from 'react-native';
import {
  assistantGroupCountLabel,
  connectedAssistantAccessLabel,
} from '@splitbook/shared/connected-assistant';
import {
  disconnectNeedsConnection,
  type AssistantsState,
  type ListedAssistant,
} from '../data/assistants';
import { PRODUCT_NAME } from '../product';
import {
  Banner,
  BottomSheet,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  SectionHeader,
  Snackbar,
  useTextColumn,
} from './compact';
import { nearDay, spellDay, spellTime } from './day-format';
import { ReadTime } from './financial-views';
import { useDismissAfter } from './group-snackbar';

/** When an assistant last called, as Settings on the web says it. */
export function lastUsedLabel(value: string | null, now = Date.now()) {
  if (!value) return 'Not used yet';
  const date = new Date(value);
  const near = nearDay(date, now);
  if (near === 'Today') return `Last used ${spellTime(date)}`;
  if (near === 'Yesterday') return 'Last used yesterday';
  return `Last used ${spellDay(date, { year: date.getFullYear() !== new Date(now).getFullYear() })}`;
}

/** "Read only + To review · 1 of 2 Groups": its access, and how many Groups it reaches. */
const reach = (assistant: ListedAssistant) =>
  [
    connectedAssistantAccessLabel(assistant.access),
    assistant.groups && assistantGroupCountLabel(assistant.groups),
  ]
    .filter(Boolean)
    .join(' · ');

function AssistantRow({
  assistant,
  offline,
  onAsk,
}: {
  assistant: ListedAssistant;
  /** Read only: Disconnect needs a connection. */
  offline: boolean;
  onAsk: (id: string) => void;
}) {
  // At large text Disconnect goes onto a line of its own, at the row's end, where it would
  // leave the name less than `largeTextColumn`, as a list row's trailing value does.
  const column = useTextColumn();
  const disconnect = (
    <CompactButton
      label="Disconnect"
      variant="text"
      dense
      // Two assistants may share a name: the host, or else the last use, tells them apart, as
      // on the web.
      accessibilityLabel={`Disconnect ${assistant.name}, ${assistant.host ?? lastUsedLabel(assistant.lastUsedAt)}`}
      disabled={offline}
      hint={offline ? disconnectNeedsConnection : undefined}
      onPress={() => onAsk(assistant.id)}
    />
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 10,
        paddingLeft: 14,
        paddingRight: 4,
        ...(column ? { flexWrap: 'wrap', rowGap: 4 } : {}),
      }}
    >
      <CompactAvatar name={assistant.name} />
      <View style={{ flex: 1, minWidth: column ?? 0, gap: 2 }}>
        <CompactText weight="semibold">{assistant.name}</CompactText>
        <CompactText variant="caption" tone="secondary">
          {reach(assistant)}
        </CompactText>
        <CompactText variant="caption" tone="secondary">
          {lastUsedLabel(assistant.lastUsedAt)}
        </CompactText>
      </View>
      {column ? <View style={{ marginLeft: 'auto' }}>{disconnect}</View> : disconnect}
    </View>
  );
}

export interface ConnectedAssistantsProps {
  state: AssistantsState;
  /** Splitbook can't be reached: what's shown is read only. */
  offline: boolean;
  onAsk: (id: string) => void;
  onCancel: () => void;
  onDisconnect: () => void;
}

/**
 * Account → Connected assistants (#622): each assistant with its access, how many Groups it
 * reaches and when it was last used, and Disconnect, asked first in a sheet. Connecting and
 * changing Groups happen on the web. Content only; the parent screen supplies the top bar,
 * scrolling and Android Back.
 */
export function ConnectedAssistants({
  state,
  offline,
  onAsk,
  onCancel,
  onDisconnect,
}: ConnectedAssistantsProps) {
  const { assistants } = state;
  const confirming = assistants?.find((assistant) => assistant.id === state.confirming) ?? null;
  return (
    <>
      <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
        Assistants act as you, only with the access you give them.
      </CompactText>
      {state.message ? (
        <Banner tone={state.unsaved ? 'offline' : 'error'} message={state.message} />
      ) : null}
      {/* This phone's copy, with when it was read: never presented as current. */}
      {assistants && state.refreshedAt !== null && (offline || state.saved) ? (
        <View style={{ paddingHorizontal: 2 }}>
          <ReadTime refreshedAt={state.refreshedAt} restored={state.saved} offline={offline} />
        </View>
      ) : null}
      {assistants && assistants.length > 0 ? (
        <View style={{ gap: 6 }}>
          <SectionHeader title={`Assistants · ${assistants.length}`} />
          <Card>
            {assistants.map((assistant, index) => (
              <View key={assistant.id}>
                {index > 0 ? <Divider inset={60} /> : null}
                <AssistantRow assistant={assistant} offline={offline} onAsk={onAsk} />
              </View>
            ))}
          </Card>
          {offline ? (
            <CompactText variant="caption" tone="secondary" style={{ paddingHorizontal: 2 }}>
              {disconnectNeedsConnection}
            </CompactText>
          ) : null}
        </View>
      ) : assistants ? (
        <Card padded>
          <View style={{ gap: 2 }}>
            <CompactText weight="semibold">No connected assistants</CompactText>
            <CompactText variant="caption" tone="secondary">
              Assistants you connect appear here.
            </CompactText>
          </View>
        </Card>
      ) : null}
      <Banner
        tone="info"
        standing
        message={`Connect an assistant, or change the Groups one reaches, on the web: ${PRODUCT_NAME} web › Settings › Connected assistants.`}
      />

      <BottomSheet
        visible={confirming !== null}
        title={`Disconnect ${confirming?.name ?? ''}?`}
        titleLines={3}
        doneLabel="Cancel"
        dismissLabel={`Cancel, keep ${confirming?.name ?? 'the assistant'} connected`}
        dismissible={!state.disconnecting}
        onDone={onCancel}
        footer={
          <>
            <CompactButton
              label="Disconnect"
              icon="unlink-outline"
              destructive
              block
              disabled={state.disconnecting || offline}
              hint={offline ? disconnectNeedsConnection : undefined}
              onPress={onDisconnect}
            />
            {offline ? (
              <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                {disconnectNeedsConnection}
              </CompactText>
            ) : null}
          </>
        }
      >
        {confirming ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <CompactAvatar name={confirming.name} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <CompactText weight="semibold">{confirming.name}</CompactText>
              <CompactText variant="caption" tone="secondary">
                {[confirming.host, connectedAssistantAccessLabel(confirming.access)]
                  .filter(Boolean)
                  .join(' · ')}
              </CompactText>
            </View>
          </View>
        ) : null}
        <CompactText>
          The assistant stops at once. Items already prepared stay in your To review. Previously
          shared information may remain in your assistant.
        </CompactText>
        {state.disconnectMessage && !offline ? (
          <Banner tone="error" message={state.disconnectMessage} />
        ) : null}
      </BottomSheet>
    </>
  );
}

/** "<name> disconnected", for Android's accessibility timeout, which can extend it. */
export function AssistantsSnackbar({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  // One notice per message, so the time runs from when it appeared, not from each render.
  const notice = useMemo(() => ({ message }), [message]);
  useDismissAfter(notice, 4000, onDismiss);
  return <Snackbar message={message} bottom={24} />;
}
