'use client';

import BalancesView from '@/components/balances/BalancesView';
import ActivityView from '@/components/activity/ActivityView';
import GroupMembersView from './GroupMembersView';
import { useGroupPage } from './group-page-context';
import { groupSettingsHref } from './group-tabs';

/*
 * The Group page's tabs other than Expenses (#305), each rendered by its own route under the
 * Group's layout, which owns the Group read, the header and the dialogs. The Balances and
 * Activity content is today's, unchanged (#312 and #313 rebuild Balances).
 */

export function GroupBalancesTab() {
  const { groupId, userId, group } = useGroupPage();
  return <BalancesView groupId={groupId} userId={userId} group={group} />;
}

export function GroupActivityTab() {
  const { groupId } = useGroupPage();
  return <ActivityView groupId={groupId} />;
}

export function GroupMembersTab() {
  const { groupId, userId, group, openInvite } = useGroupPage();
  return (
    <GroupMembersView
      members={group.members}
      userId={userId}
      settingsHref={groupSettingsHref(groupId)}
      onInvite={openInvite}
    />
  );
}
