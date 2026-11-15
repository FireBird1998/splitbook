import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupCategory, MemberRole } from '@splitbook/shared/types';
import { isGroupAdmin, removalSendable } from '../data/member-roles';
import { firstName } from '@splitbook/shared/cross-currency-payment';
import type {
  LeaveGroupState,
  MemberRemovalState,
  MemberRoleState,
  MobileGroup,
} from '../data/types';
import {
  Banner,
  BottomSheet,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  LinearProgress,
  ListRow,
  OptionRow,
  SectionHeader,
  Snackbar,
  TopBar,
  useTextColumn,
} from './compact';
import { useDismissAfter } from './group-snackbar';
import { Icon, type IconName } from './primitives';
import { fonts, useTheme } from './theme';
import { SEPARATOR, counted } from '@splitbook/shared/separator';

const themeIcons: Record<GroupCategory, IconName> = {
  trip: 'airplane-outline',
  home: 'home-outline',
  couple: 'heart-outline',
  work: 'briefcase-outline',
  other: 'layers-outline',
};

const inviteNeedsConnection = 'Inviting needs a connection.';
export const leaveNeedsConnection = 'Leaving a Group needs a connection.';
export const leaveExplanation =
  'You won’t see this Group or its balances any more. Its Expenses and Activity stay for the others. You can rejoin with an invite.';
export const leaveDiscardsDraft =
  'Your Expense draft for this Group is kept on this device. Leaving discards it.';

export const memberChangesNeedConnection = 'Changing roles or removing members needs a connection.';
const adminHint = 'Tap a member to change their role or remove them.';
const memberHint = 'Only admins can change roles or remove members.';
/** How long a change's Snackbar stays, unless Android's accessibility timeout extends it. */
const doneShownFor = 4000;

/** An admin's role changes (#1252): the change's state and what choosing one does. */
export interface MemberRoleActions {
  state: MemberRoleState;
  offline: boolean;
  /** Make admin or Make member, chosen in a member's options: sent at once. */
  onChange: (userId: string, role: MemberRole) => void;
  /** The member whose options were open is no longer listed. */
  onMemberGone: (userId: string, name: string) => void;
  onDismissDone: () => void;
}

/** Remove from Group (#1253): the sheet's state and what each of its buttons does. */
export interface MemberRemovalActions {
  state: MemberRemovalState;
  offline: boolean;
  /** Remove from Group, chosen in a member's options: asks first. */
  onReview: (userId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** Go to Balances, where an open balance shows. */
  onCheck: () => void;
  /** Open on the web, where a broken recurring Expense is fixed. */
  onOpenWeb: () => void;
}

/** Leave Group: the sheet's state and what each of its buttons does. */
export interface LeaveGroupActions {
  state: LeaveGroupState;
  offline: boolean;
  toReviewCount?: number;
  onOpen: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** Go to Balances or Go to Expenses, where what blocks leaving shows. */
  onCheck: () => void;
}

/** A label on the left and its value on the right, read as one "Label: value". */
function DetailRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  // At large text the value goes onto a line of its own, at the row's end, where the label
  // would leave it less than `largeTextColumn`: at 200% on a 360dp phone, "Month" broke into
  // "Mon / th" beside "Expenses shown by" (#639).
  const column = useTextColumn();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingVertical: 12,
        paddingHorizontal: 14,
        ...(column ? { flexWrap: 'wrap', alignContent: 'center', rowGap: 4 } : {}),
      }}
    >
      <CompactText tone="secondary" style={column ? { flexShrink: 1 } : undefined}>
        {label}
      </CompactText>
      <View
        style={{
          flexShrink: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          ...(column ? { flex: 1, minWidth: column } : {}),
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** The Group's Theme, currency, Month lens (Households only) and description. */
function GroupDetails({ group }: { group: MobileGroup }) {
  const theme = useTheme();
  const groupTheme = getGroupTheme(group.category);
  return (
    <Card>
      <DetailRow label="Theme" value={groupTheme.label}>
        <Icon name={themeIcons[group.category]} size={20} color={theme.brand.main} />
        <CompactText>{groupTheme.label}</CompactText>
      </DetailRow>
      <Divider />
      <DetailRow label="Currency" value={group.defaultCurrency}>
        <CompactText style={{ fontFamily: fonts.mono }}>{group.defaultCurrency}</CompactText>
      </DetailRow>
      {groupTheme.signature === 'monthCycle' ? (
        <>
          <Divider />
          <DetailRow label="Expenses shown by" value="Month">
            <CompactText>Month</CompactText>
          </DetailRow>
        </>
      ) : null}
      {group.description ? (
        <>
          <Divider />
          <DetailRow label="Description" value={group.description}>
            <CompactText style={{ flexShrink: 1, textAlign: 'right' }}>
              {group.description}
            </CompactText>
          </DetailRow>
        </>
      ) : null}
    </Card>
  );
}

/**
 * Leave Group's confirm sheet: what leaving means and the draft it discards. A save or payment
 * that may already be recorded blocks it, and the server's refusals show in its own words; an
 * open balance or unconfirmed save offers the Group destination that shows it. Leave Group stays
 * for a concurrent change or a failure, to try again.
 */
function LeaveGroupSheet({ group, leave }: { group: MobileGroup; leave: LeaveGroupActions }) {
  const { state, offline } = leave;
  const leaving = state.status === 'leaving';
  const deleting = state.deleteIfLastMember === true;
  const retryable =
    state.status !== 'blocked' &&
    (state.status !== 'refused' ||
      ['LEAVE_CONFLICT', 'GROUP_DELETION_CONFIRMATION_REQUIRED'].includes(state.code ?? ''));
  const ready = ['confirm', 'refused', 'error'].includes(state.status);
  return (
    <BottomSheet
      visible={state.status !== 'closed' && state.groupId === group.id}
      title={`Leave ${group.name}?`}
      doneLabel="Cancel"
      dismissLabel="Cancel, staying in this Group"
      dismissible={!leaving}
      onDone={leave.onCancel}
      footer={
        <>
          {state.check ? (
            <CompactButton
              label={state.check === 'balances' ? 'Go to Balances' : 'Go to Expenses'}
              variant="tonal"
              block
              onPress={leave.onCheck}
            />
          ) : null}
          {retryable ? (
            <CompactButton
              label={deleting ? 'Leave and delete Group' : 'Leave Group'}
              icon="exit-outline"
              destructive
              block
              disabled={!ready || offline}
              hint={offline ? leaveNeedsConnection : undefined}
              onPress={leave.onConfirm}
            />
          ) : null}
          {retryable && offline ? (
            <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {leaveNeedsConnection}
            </CompactText>
          ) : null}
        </>
      }
    >
      {state.status === 'checking' || leaving ? (
        <View style={{ marginHorizontal: -20 }}>
          <LinearProgress
            label={leaving ? 'Leaving this Group' : 'Checking this device for unsaved work'}
          />
        </View>
      ) : null}
      <CompactText>
        {deleting
          ? 'Leaving will permanently delete this Group and its history. Expenses, Settlements and Activity will be removed. You cannot rejoin this Group.'
          : leaveExplanation}
      </CompactText>
      {!!leave.toReviewCount && (
        <CompactText>
          You have {counted(leave.toReviewCount, 'item')} in To review for {group.name}. They’re
          kept but hidden while you’re not a member.
        </CompactText>
      )}
      {state.draft && state.status !== 'blocked' ? (
        <Banner tone="info" message={leaveDiscardsDraft} />
      ) : null}
      {state.message ? (
        <Banner tone={state.status === 'blocked' ? 'warning' : 'error'} message={state.message} />
      ) : null}
    </BottomSheet>
  );
}

type Member = MobileGroup['members'][number];
/** A role as the list shows it, and while it is being given (#1252). */
const roleText: Record<MemberRole, { name: string; making: string }> = {
  admin: { name: 'Admin', making: 'Making admin…' },
  member: { name: 'Member', making: 'Making member…' },
};

/**
 * Member options: what an admin can do to another member, opened from their row (#1252). Make
 * admin or Make member is sent at once, and the sheet closes on it. Offline, or while another
 * role change is made, the options show but can't be chosen.
 */
function MemberOptionsSheet({
  member,
  roles,
  onRemove,
  onClose,
}: {
  member: Member | null;
  roles: MemberRoleActions;
  /** Remove from Group: closes these options for its confirm (#1253). */
  onRemove: (userId: string) => void;
  onClose: () => void;
}) {
  const unavailable = roles.offline || roles.state.status === 'changing';
  const choose = (role: MemberRole) => {
    if (!member || unavailable) return;
    onClose();
    roles.onChange(member.user.id, role);
  };
  return (
    <BottomSheet
      visible={!!member}
      title="Member options"
      doneLabel="Close"
      dismissLabel="Close member options"
      onDone={onClose}
    >
      {member ? (
        <>
          <View
            accessible
            accessibilityLabel={`${member.user.name}, ${roleText[member.role].name}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <CompactAvatar name={member.user.name} large />
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <CompactText weight="semibold">{member.user.name}</CompactText>
              <CompactText variant="caption" tone="secondary">
                {roleText[member.role].name}
              </CompactText>
            </View>
          </View>
          <Card>
            {member.role === 'admin' ? (
              <OptionRow
                icon="person-outline"
                title="Make member"
                meta="Keeps adding Expenses; can’t change the Group"
                disabled={unavailable}
                onPress={() => choose('member')}
              />
            ) : (
              <OptionRow
                icon="shield-checkmark-outline"
                title="Make admin"
                meta="Can change Group settings, Tags and members"
                disabled={unavailable}
                onPress={() => choose('admin')}
              />
            )}
            <Divider inset={66} />
            <OptionRow
              icon="person-remove-outline"
              tone="negative"
              title="Remove from Group"
              meta="You’ll be asked to confirm"
              disabled={unavailable}
              onPress={() => {
                onClose();
                onRemove(member.user.id);
              }}
            />
          </Card>
          {roles.offline ? (
            <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {memberChangesNeedConnection}
            </CompactText>
          ) : null}
        </>
      ) : null}
    </BottomSheet>
  );
}

/**
 * Remove from Group's confirm (#1253): what removing means, named for the member and the Group.
 * A refusal that leaves nothing to send shows in place of the explanation and the button, with
 * the way forward where there is one; the Group changing meanwhile, or a failure, keeps Remove to
 * try again. Not dismissible while the removal is sent.
 */
function RemoveMemberSheet({
  group,
  removal,
}: {
  group: MobileGroup;
  removal: MemberRemovalActions;
}) {
  const { state, offline } = removal;
  const removing = state.status === 'removing';
  const blocked = state.status === 'refused' && !removalSendable(state);
  const name = state.name ?? '';
  return (
    <BottomSheet
      visible={state.status !== 'closed' && state.groupId === group.id}
      title={`Remove ${name} from ${group.name}?`}
      titleLines={3}
      doneLabel={blocked ? 'Close' : 'Cancel'}
      dismissLabel={`${blocked ? 'Close' : 'Cancel'}, keeping ${name} in this Group`}
      dismissible={!removing}
      onDone={removal.onCancel}
      footer={
        blocked ? (
          state.check === 'balances' ? (
            <CompactButton label="Go to Balances" variant="tonal" block onPress={removal.onCheck} />
          ) : state.check === 'web' ? (
            <CompactButton
              label="Open on the web"
              icon="open-outline"
              variant="tonal"
              block
              onPress={removal.onOpenWeb}
            />
          ) : null
        ) : (
          <>
            <CompactButton
              label="Remove from Group"
              destructive
              block
              disabled={removing || offline}
              hint={offline ? memberChangesNeedConnection : undefined}
              onPress={removal.onConfirm}
            />
            {offline ? (
              <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                {memberChangesNeedConnection}
              </CompactText>
            ) : null}
          </>
        )
      }
    >
      {removing ? (
        <View style={{ marginHorizontal: -20 }}>
          <LinearProgress label={`Removing ${name}`} />
        </View>
      ) : null}
      {state.message ? (
        <Banner tone={blocked ? 'warning' : 'error'} message={state.message} />
      ) : null}
      {blocked ? null : (
        <>
          <CompactText>
            {firstName(name)} won’t see this Group or its balances any more. The Expenses and
            payments they’re part of stay for everyone else.
          </CompactText>
          <CompactText>They can rejoin with an invite.</CompactText>
        </>
      )}
    </BottomSheet>
  );
}

/** A change's short note, naming the person; it has no action and goes after a while. */
function DoneNote({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const notice = useMemo(() => ({ message }), [message]);
  useDismissAfter(notice, doneShownFor, onDismiss);
  return <Snackbar message={message} bottom={24} />;
}

/**
 * Members and Group details: the Group's details, then its members with their roles and Invite,
 * and Leave Group. An admin taps another member for their options: a role change (#1252) or
 * Remove from Group, which asks first (#1253).
 */
export function GroupMembers({
  group,
  currentUserId,
  back,
  invite,
  leave,
  roles,
  removal,
  notice,
  unavailable,
}: {
  /** Null when the Group was lost while the page was open. */
  group: MobileGroup | null;
  currentUserId: string;
  back: { label: string; onPress: () => void };
  invite: { onPress: () => void; disabled: boolean; offline: boolean };
  leave: LeaveGroupActions;
  roles: MemberRoleActions;
  removal: MemberRemovalActions;
  /** Shown above the details, e.g. the offline notice. */
  notice?: ReactNode;
  unavailable?: string | null;
}) {
  const theme = useTheme();
  const isAdmin = isGroupAdmin(group, currentUserId);
  /** The member whose options are open. */
  const [selected, setSelected] = useState<string | null>(null);
  const selectedMember =
    (selected && group?.members.find((member) => member.user.id === selected)) || null;
  /** Who the open options were for, as they were when opened. */
  const openedFor = useRef<Member | null>(null);
  // Their options close once nothing there applies (MembersRolesNotes): you're no longer an
  // admin, the member has left the list, which a Snackbar says, or their role changed meanwhile.
  useEffect(() => {
    const opened = openedFor.current;
    if (!selected || !opened) return;
    if (!isAdmin || !selectedMember || selectedMember.role !== opened.role) setSelected(null);
    if (isAdmin && !selectedMember) roles.onMemberGone(opened.user.id, opened.user.name);
  }, [selected, selectedMember, isAdmin]);
  const open = (member: Member) => {
    openedFor.current = member;
    setSelected(member.user.id);
  };
  const changing = roles.state.status === 'changing' ? roles.state : null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar
        title="Members and details"
        subtitle={group?.name}
        leading={{ kind: 'back', ...back }}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
      >
        {notice}
        {roles.state.status === 'failed' && roles.state.message ? (
          <Banner tone="error" message={roles.state.message} />
        ) : null}
        {!group ? (
          <Banner tone="error" message={unavailable ?? 'This Group isn’t available.'} />
        ) : (
          <>
            <GroupDetails group={group} />
            <SectionHeader
              title={`Members${SEPARATOR}${group.members.length}`}
              trailing={
                <CompactButton
                  label="Invite"
                  icon="person-add-outline"
                  variant="tonal"
                  dense
                  accessibilityLabel="Invite people"
                  disabled={invite.disabled || invite.offline}
                  hint={invite.offline ? inviteNeedsConnection : undefined}
                  onPress={invite.onPress}
                />
              }
            />
            <Card>
              {group.members.map((member, index) => {
                const you = member.user.id === currentUserId;
                const role = roleText[member.role].name;
                // An admin opens another member's options from their row (#1252).
                const actionable = isAdmin && !you;
                const shield =
                  member.role === 'admin' ? (
                    <Icon name="shield-checkmark-outline" size={22} color={theme.brand.main} />
                  ) : null;
                return (
                  <View key={member.user.id}>
                    {index > 0 ? <Divider inset={58} /> : null}
                    <ListRow
                      leading={<CompactAvatar name={member.user.name} />}
                      title={you ? `${member.user.name}${SEPARATOR}You` : member.user.name}
                      meta={role}
                      busy={
                        changing?.userId === member.user.id && changing.role
                          ? roleText[changing.role].making
                          : undefined
                      }
                      trailing={
                        actionable ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            {shield}
                            <Icon name="ellipsis-vertical" size={20} color={theme.textMuted} />
                          </View>
                        ) : (
                          shield
                        )
                      }
                      onPress={actionable ? () => open(member) : undefined}
                      accessibilityLabel={[
                        member.user.name,
                        you ? 'You' : null,
                        role,
                        actionable ? 'options' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    />
                  </View>
                );
              })}
            </Card>
            {invite.offline ? (
              <CompactText variant="small" tone="secondary">
                {inviteNeedsConnection}
              </CompactText>
            ) : null}
            <CompactText variant="small" tone="secondary">
              {!isAdmin ? memberHint : roles.offline ? memberChangesNeedConnection : adminHint}
            </CompactText>
            <View style={{ gap: 6, paddingTop: 12 }}>
              <CompactButton
                label="Leave Group"
                icon="exit-outline"
                variant="tonal"
                destructive
                block
                disabled={leave.offline}
                hint={leave.offline ? leaveNeedsConnection : undefined}
                onPress={leave.onOpen}
              />
              {leave.offline ? (
                <CompactText variant="small" tone="secondary">
                  {leaveNeedsConnection}
                </CompactText>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
      {group ? <LeaveGroupSheet group={group} leave={leave} /> : null}
      {group && isAdmin ? (
        <MemberOptionsSheet
          member={selectedMember}
          roles={roles}
          onRemove={removal.onReview}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {group ? <RemoveMemberSheet group={group} removal={removal} /> : null}
      {roles.state.done ? (
        <DoneNote message={roles.state.done} onDismiss={roles.onDismissDone} />
      ) : null}
    </View>
  );
}
