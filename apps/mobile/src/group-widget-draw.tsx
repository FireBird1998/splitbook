import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import {
  groupWidget,
  type GroupWidgetSetup,
  type GroupWidgetSize,
} from '@splitbook/shared/group-widget';
import type { WidgetCopy, WidgetSession, WidgetTarget } from '@splitbook/shared/balances-widget';
import { SEPARATOR } from '@splitbook/shared/separator';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import { widgetLink } from './widget-links';
import Constants from 'expo-constants';

export function drawGroup(
  copy: WidgetCopy | null,
  setup: GroupWidgetSetup,
  size: GroupWidgetSize,
  session: WidgetSession,
  now: number,
  t: SemanticTokens,
) {
  const part =
    copy?.accountId === setup.accountId
      ? copy.lostGroupIds?.includes(setup.groupId)
        ? null
        : copy.groups?.[setup.groupId]
      : undefined;
  const view = groupWidget(part, setup, size, session, now),
    small = size === '2x2';
  const color = (value: string) => value as `#${string}`;
  const action = (target: WidgetTarget) => ({
    uri: widgetLink(target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
  });
  const group = { kind: 'group' as const, groupId: setup.groupId },
    config = { kind: 'setup' as const, widgetId: setup.widgetId };
  const balanceTone = view.muted
    ? t.textMuted
    : view.balanceTone === 'neutral'
      ? t.textSecondary
      : t.status[view.balanceTone];
  const target = view.target === 'setup' ? config : view.target === 'sign-in' ? 'sign-in' : group;
  const text = (value: string, tone = t.text, fontSize = 12, bold = false, mono = false) => (
    <TextWidget
      text={value}
      style={{
        color: color(tone),
        fontSize,
        fontWeight: bold ? 'bold' : 'normal',
        ...(mono ? { fontFamily: 'monospace' } : {}),
      }}
    />
  );
  const button = (label: string, target: WidgetTarget) => (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={action(target)}
      accessibilityLabel={label}
      style={{
        backgroundColor: color(t.brand.bg),
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        ...(small ? { width: 'match_parent' as const } : {}),
      }}
    >
      {text(label, t.brand.main, 12, true)}
    </FlexWidget>
  );
  const themePath =
    view.theme === 'home'
      ? 'M3 11L12 3l9 8M6 10v11h12V10M10 21v-7h4v7'
      : view.theme === 'trip'
        ? 'M12 2v20M3 13l9-5 9 5v3l-9-3-9 3zM8 21l4-3 4 3'
        : view.theme === 'work'
          ? 'M3 8h18v13H3zM8 8V3h8v5M3 13h18'
          : view.theme === 'couple'
            ? 'M12 21L3 12C-2 3 8 0 12 6C16 0 26 3 21 12z'
            : 'M3 21v-4a5 5 0 0110 0v4M8 11a4 4 0 100-8 4 4 0 000 8M15 4a4 4 0 010 8M16 16a5 5 0 015 5';
  const mark = (
    <FlexWidget style={{ padding: 8, borderRadius: 12, backgroundColor: color(t.brand.bg) }}>
      <SvgWidget
        svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="${themePath}" fill="none" stroke="${t.brand.main}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
        style={{ width: 20, height: 20 }}
      />
    </FlexWidget>
  );
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={action(target)}
      accessibilityLabel={[
        view.name,
        view.title,
        view.balance,
        ...view.payments.map((p) => p.label + ' ' + p.amount),
        view.saved,
        view.final ? 'final' : null,
      ]
        .filter(Boolean)
        .join('. ')}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: 14,
        backgroundColor: color(t.surface),
        borderRadius: 24,
        justifyContent: 'space-between',
      }}
    >
      {view.name ? (
        <FlexWidget
          style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', flexGap: 8 }}
        >
          {mark}
          <FlexWidget style={{ flex: 1, flexGap: 3 }}>
            {text(view.name, t.text, 13, true)}
            {small && view.saved
              ? text(view.saved, t.textMuted, 9)
              : text(view.balance, balanceTone, 11, true)}
          </FlexWidget>
          {!small && view.saved ? text(view.saved, t.textMuted, 9) : null}
        </FlexWidget>
      ) : null}
      {view.title ? (
        <FlexWidget style={{ flexGap: 10 }}>
          {text(view.title, t.text, small ? 13 : 15, true)}
          {text(view.description, t.textSecondary, small ? 10 : 12)}
        </FlexWidget>
      ) : null}
      {view.state === 'loading' ? (
        <FlexWidget style={{ flexGap: 12 }}>
          {[120, 180, 160].map((width, index) => (
            <FlexWidget
              key={index}
              style={{ width, height: 14, borderRadius: 6, backgroundColor: color(t.surfaceMuted) }}
            />
          ))}
        </FlexWidget>
      ) : null}
      {view.name && small ? (
        <FlexWidget style={{ flexGap: 8 }}>
          {view.compactAmount ? (
            <FlexWidget style={{ flexGap: 4 }}>
              {text(
                view.compactLabel!,
                view.muted
                  ? t.textMuted
                  : view.compactLabel === 'You owe'
                    ? t.status.negative
                    : t.status.positive,
                10,
                true,
              )}
              {text(view.compactAmount, view.muted ? t.textMuted : t.text, 18, true, true)}
              {view.currencyOverflow ? text(view.currencyOverflow, t.brand.main, 10, true) : null}
            </FlexWidget>
          ) : (
            text(view.balance, balanceTone, 14, true)
          )}
          {view.people ? text(view.people, t.textSecondary, 11) : null}
        </FlexWidget>
      ) : null}
      {view.payments.length ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            borderRadius: 14,
            backgroundColor: color(t.surfaceMuted),
            padding: 6,
            flexGap: 2,
          }}
        >
          {view.payments.map((payment, index) => (
            <FlexWidget
              key={index}
              clickAction="OPEN_URI"
              clickActionData={action({
                kind: 'settle',
                groupId: setup.groupId,
                ...(payment.payment ? { payment: payment.payment } : {}),
              })}
              accessibilityLabel={payment.label + ' ' + payment.amount}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: 'match_parent',
                padding: 7,
                flexGap: 12,
              }}
            >
              <FlexWidget
                style={{ padding: 5, borderRadius: 8, backgroundColor: color(t.surface) }}
              >
                {text(payment.firstName[0] ?? '', t.textSecondary, 10, true)}
              </FlexWidget>
              <FlexWidget style={{ flex: 1 }}>{text(payment.label, t.text, 12)}</FlexWidget>
              {text(
                payment.amount,
                view.muted ? t.textMuted : payment.incoming ? t.status.positive : t.text,
                13,
                true,
                true,
              )}
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: small ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexGap: 8,
        }}
      >
        {view.more ? (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={action({ kind: 'settle', groupId: setup.groupId })}
            accessibilityLabel={view.more}
          >
            {text(view.more, t.brand.main, 10, true)}
          </FlexWidget>
        ) : view.final ? (
          text(`Archived${SEPARATOR}final`, t.textSecondary, 11, true)
        ) : view.action === 'Open to update' ? (
          text(view.action, t.textSecondary, 11)
        ) : null}
        {view.target === 'setup'
          ? button(view.action!, config)
          : view.addExpense
            ? button('＋ Add expense', { kind: 'expense', groupId: setup.groupId })
            : null}
      </FlexWidget>
    </FlexWidget>
  );
}
