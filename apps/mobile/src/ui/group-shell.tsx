import { useState, type ReactNode, type Ref } from 'react';
import { RefreshControl, ScrollView, View, type ScrollViewProps } from 'react-native';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupDestination, MobileGroup } from '../data/types';
import {
  BottomSheet,
  Card,
  Divider,
  GroupNavBar,
  IconButton,
  IconTile,
  LinearProgress,
  ListRow,
  TopBar,
} from './compact';
import { useTheme } from './theme';

/** "Household · 3 members · INR" */
export function groupSubtitle(group: MobileGroup) {
  const count = group.members.length;
  return `${getGroupTheme(group.category).label} · ${count} ${count === 1 ? 'member' : 'members'} · ${group.defaultCurrency}`;
}

interface GroupShellProps {
  /** Null until the Group is known, from its read or the saved Groups list. */
  group: MobileGroup | null;
  destination: GroupDestination;
  onDestination: (destination: GroupDestination) => void;
  back: { label: string; onPress: () => void };
  /** Quiet refresh status beside the title. */
  status?: ReactNode;
  /** A first load's label: one progress bar under the top bar. */
  progress?: string | null;
  invite: { onPress: () => void; disabled: boolean; offline: boolean };
  /** Opens Members and Group details. */
  onMembers: () => void;
  onRefresh: () => void;
  pull: { refreshing: boolean; onRefresh: () => void };
  /** The destination's scroll view, so returning from an Expense can restore its offset. */
  scrollRef?: Ref<ScrollView>;
  scroll?: Pick<
    ScrollViewProps,
    'scrollEventThrottle' | 'onScroll' | 'onScrollBeginDrag' | 'onLayout' | 'onContentSizeChange'
  >;
  /** Floats above the bottom navigation, such as the save snackbar. */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * A Group's frame: the compact top bar, the current destination's content and the bottom
 * navigation. ⋮ opens the Group's options, including Members and Group details.
 */
export function GroupShell({
  group,
  destination,
  onDestination,
  back,
  status,
  progress,
  invite,
  onMembers,
  onRefresh,
  pull,
  scrollRef,
  scroll,
  overlay,
  children,
}: GroupShellProps) {
  const theme = useTheme();
  const [options, setOptions] = useState(false);
  const close = () => setOptions(false);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar
        title={group?.name ?? 'Group'}
        subtitle={group ? groupSubtitle(group) : undefined}
        leading={{ kind: 'back', ...back }}
        status={status}
        actions={
          group ? (
            <>
              <IconButton
                icon="person-add-outline"
                label={
                  invite.offline ? 'Invite people. Inviting needs a connection' : 'Invite people'
                }
                disabled={invite.disabled || invite.offline}
                onPress={invite.onPress}
              />
              <IconButton
                icon="ellipsis-vertical-outline"
                label="Group options"
                onPress={() => setOptions(true)}
              />
            </>
          ) : null
        }
      />
      {progress ? <LinearProgress label={progress} /> : null}
      <ScrollView
        // Each destination starts at its own top.
        key={destination}
        ref={scrollRef}
        {...scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.brand.main}
            colors={[theme.brand.main]}
          />
        }
      >
        {children}
      </ScrollView>
      <GroupNavBar
        groupName={group?.name ?? 'Group'}
        value={destination}
        onChange={onDestination}
      />
      {overlay}
      {group ? (
        <BottomSheet
          visible={options}
          title={group.name}
          subtitle={groupSubtitle(group)}
          onDone={close}
          dismissLabel="Close Group options"
        >
          <Card>
            <ListRow
              leading={<IconTile icon="people-outline" />}
              title="Members and Group details"
              onPress={() => {
                close();
                onMembers();
              }}
            />
            <Divider inset={66} />
            <ListRow
              leading={<IconTile icon="refresh-outline" />}
              title="Refresh"
              meta="Check for the latest changes"
              onPress={() => {
                close();
                onRefresh();
              }}
            />
          </Card>
        </BottomSheet>
      ) : null}
    </View>
  );
}
