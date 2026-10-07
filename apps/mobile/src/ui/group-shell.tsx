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
  progressHeight,
} from './compact';
import { useTheme } from './theme';

/** Under the floating action: it sits 16 above the navigation and is 56 tall, then a gap. */
export const floatingRoom = 16 + 56 + 16;

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
  /** One progress bar under the top bar, so labelled: a first load, or a refresh. */
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
    | 'scrollEventThrottle'
    | 'onScroll'
    | 'onScrollBeginDrag'
    | 'onScrollEndDrag'
    | 'onMomentumScrollEnd'
    | 'onLayout'
    | 'onContentSizeChange'
  >;
  /** Floats above the bottom navigation, such as the save snackbar. */
  overlay?: ReactNode;
  /** A floating action shows over the content, which leaves room to scroll clear of it. */
  floating?: boolean;
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
  progress,
  invite,
  onMembers,
  onRefresh,
  pull,
  scrollRef,
  scroll,
  overlay,
  floating = false,
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
      {/* The bar's room stays when nothing loads, so the content never moves. */}
      {progress ? <LinearProgress label={progress} /> : <View style={{ height: progressHeight }} />}
      <ScrollView
        // Each destination starts at its own top.
        key={destination}
        ref={scrollRef}
        {...scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: floating ? floatingRoom : 24,
          gap: 12,
        }}
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
