import { useState, type ReactNode, type Ref } from 'react';
import { RefreshControl, ScrollView, View, type ScrollViewProps } from 'react-native';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupDestination, MobileGroup } from '../data/types';
import {
  BottomSheet,
  Card,
  CompactAvatar,
  CompactText,
  Divider,
  GroupNavBar,
  IconButton,
  IconTile,
  ListRow,
  SectionHeader,
  TopBar,
} from './compact';
import { useTheme } from './theme';

/** "Household · 3 members · INR" */
export function groupSubtitle(group: MobileGroup) {
  const count = group.members.length;
  return `${getGroupTheme(group.category).label} · ${count} ${count === 1 ? 'member' : 'members'} · ${group.defaultCurrency}`;
}

interface GroupShellProps {
  /** Null until the Group has been read. */
  group: MobileGroup | null;
  currentUserId: string;
  destination: GroupDestination;
  onDestination: (destination: GroupDestination) => void;
  back: { label: string; onPress: () => void };
  /** Quiet refresh status beside the title. */
  status?: ReactNode;
  invite: { onPress: () => void; disabled: boolean; offline: boolean };
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
 * navigation. ⋮ opens the Group's options and details.
 */
export function GroupShell({
  group,
  currentUserId,
  destination,
  onDestination,
  back,
  status,
  invite,
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
          footer={
            <CompactText variant="small" tone="secondary">
              Role changes and removals happen on the web for now.
            </CompactText>
          }
        >
          <View style={{ gap: 12 }}>
            <Card>
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
            {group.description ? (
              <CompactText tone="secondary">{group.description}</CompactText>
            ) : null}
            <SectionHeader title="Members" />
            <Card>
              {group.members.map((member, index) => (
                <View key={member.user.id}>
                  {index > 0 ? <Divider inset={58} /> : null}
                  <ListRow
                    leading={<CompactAvatar name={member.user.name} />}
                    title={member.user.name}
                    meta={[
                      member.user.id === currentUserId ? 'You' : null,
                      member.role === 'admin' ? 'Group admin' : 'Member',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </View>
              ))}
            </Card>
          </View>
        </BottomSheet>
      ) : null}
    </View>
  );
}
