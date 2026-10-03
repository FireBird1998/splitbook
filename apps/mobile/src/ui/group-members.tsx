import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupCategory } from '@splitbook/shared/types';
import type { MobileGroup } from '../data/types';
import {
  Banner,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  ListRow,
  SectionHeader,
  TopBar,
} from './compact';
import { Icon, type IconName } from './primitives';
import { fonts, useTheme } from './theme';

const themeIcons: Record<GroupCategory, IconName> = {
  trip: 'airplane-outline',
  home: 'home-outline',
  couple: 'heart-outline',
  work: 'briefcase-outline',
  other: 'layers-outline',
};

const inviteNeedsConnection = 'Inviting needs a connection.';

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
      }}
    >
      <CompactText tone="secondary">{label}</CompactText>
      <View
        style={{
          flexShrink: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
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
 * Members and Group details: the Group's details, then its members with their roles and Invite.
 * Role changes and removals stay on the web.
 */
export function GroupMembers({
  group,
  currentUserId,
  back,
  invite,
  notice,
  unavailable,
}: {
  /** Null when the Group was lost while the page was open. */
  group: MobileGroup | null;
  currentUserId: string;
  back: { label: string; onPress: () => void };
  invite: { onPress: () => void; disabled: boolean; offline: boolean };
  /** Shown above the details, e.g. the offline notice. */
  notice?: ReactNode;
  unavailable?: string | null;
}) {
  const theme = useTheme();
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
        {!group ? (
          <Banner tone="error" message={unavailable ?? 'This Group isn’t available.'} />
        ) : (
          <>
            <GroupDetails group={group} />
            <SectionHeader
              title={`Members · ${group.members.length}`}
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
                const role = member.role === 'admin' ? 'Admin' : 'Member';
                return (
                  <View
                    key={member.user.id}
                    accessible
                    accessibilityLabel={[member.user.name, you ? 'You' : null, role]
                      .filter(Boolean)
                      .join(', ')}
                  >
                    {index > 0 ? <Divider inset={58} /> : null}
                    <ListRow
                      leading={<CompactAvatar name={member.user.name} />}
                      title={you ? `${member.user.name} · You` : member.user.name}
                      meta={role}
                      trailing={
                        member.role === 'admin' ? (
                          <Icon
                            name="shield-checkmark-outline"
                            size={22}
                            color={theme.brand.main}
                          />
                        ) : null
                      }
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
              Changing roles or removing members is done on the web for now.
            </CompactText>
          </>
        )}
      </ScrollView>
    </View>
  );
}
