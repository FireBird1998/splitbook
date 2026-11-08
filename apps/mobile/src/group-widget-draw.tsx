import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';
import { SEPARATOR } from '@splitbook/shared/separator';
import { hiddenLabel } from './widget-hidden-label';
import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import {
  groupWidget,
  type GroupWidgetSetup,
  type GroupWidgetSize,
} from '@splitbook/shared/group-widget';
import type { WidgetCopy, WidgetSession, WidgetTarget } from '@splitbook/shared/balances-widget';
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
  fontScale = 1,
) {
  const part =
    copy?.accountId === setup.accountId
      ? copy.lostGroupIds?.includes(setup.groupId)
        ? null
        : copy.groups?.[setup.groupId]
      : undefined;
  const view = groupWidget(part, setup, size, session, now, fontScale),
    small = size === '2x2',
    l = view.layout;
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
      style={{
        backgroundColor: color(t.brand.bg),
        paddingHorizontal: l.actionPaddingHorizontal,
        paddingVertical: 9,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        ...(small || l.stackPayments ? { width: 'match_parent' as const } : {}),
      }}
    >
      {text(label, t.brand.main, l.actionFontSize, true)}
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
      accessibilityLabel={view.summary}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: l.stackPayments ? 10 : 14,
        backgroundColor: color(t.surface),
        borderRadius: 24,
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexGap: 8 }}>
        {view.name ? (
          <FlexWidget
            style={{
              flexDirection: 'row',
              width: 'match_parent',
              alignItems: 'center',
              flexGap: 8,
            }}
          >
            {l.showTile ? mark : null}
            <FlexWidget style={{ flex: 1, flexGap: 3 }}>
              <FlexWidget
                style={{
                  flexDirection: l.stackHeader ? 'column' : 'row',
                  alignItems: l.stackHeader ? 'flex-start' : 'center',
                  flexGap: 6,
                }}
              >
                {text(view.name, t.text, 13, true)}
                {view.final ? (
                  <FlexWidget
                    style={{ backgroundColor: color(t.surfaceMuted), borderRadius: 6, padding: 4 }}
                  >
                    {text('Archived', t.textSecondary, 9, true)}
                  </FlexWidget>
                ) : null}
              </FlexWidget>
              {small && l.showSaved && view.saved
                ? text(view.saved, t.textMuted, 9)
                : text(view.balance, balanceTone, 11, true)}
              {!small && l.stackHeader && l.showSaved && view.saved
                ? text(view.saved, t.textMuted, 9)
                : null}
            </FlexWidget>
            {!small && !l.stackHeader && l.showSaved && view.saved
              ? text(view.saved, t.textMuted, 9)
              : null}
          </FlexWidget>
        ) : null}
        {view.final && l.showDescription
          ? text('Nothing more can be saved here.', t.textSecondary, 11)
          : null}
        {view.title ? (
          <FlexWidget
            style={{
              width: 'match_parent',
              flexDirection: 'row',
              alignItems: 'flex-start',
              flexGap: 12,
            }}
          >
            {l.showTile && ['lost-access', 'expired', 'signed-out'].includes(view.state) ? (
              <FlexWidget
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: color(t.surfaceMuted),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {view.state === 'signed-out' ? (
                  <SvgWidget
                    svg={t.mode === 'dark' ? darkMark : lightMark}
                    style={{ width: 30, height: 30 }}
                  />
                ) : (
                  <SvgWidget
                    svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><g fill="none" stroke="${t.textSecondary}" stroke-width="1.8">${view.state === 'expired' ? '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'}</g></svg>`}
                    style={{ width: 24, height: 24 }}
                  />
                )}
              </FlexWidget>
            ) : null}
            <FlexWidget style={{ flex: 1, flexGap: 10 }}>
              {text(view.title, t.text, small ? 13 : 15, true)}
              {l.showDescription ? text(view.description, t.textSecondary, small ? 10 : 12) : null}
            </FlexWidget>
          </FlexWidget>
        ) : null}
        {view.state === 'loading' ? (
          <FlexWidget style={{ flexGap: 12 }}>
            {[120, 180, 160].map((width, index) => (
              <FlexWidget
                key={index}
                style={{
                  width,
                  height: 14,
                  borderRadius: 6,
                  backgroundColor: color(t.surfaceMuted),
                }}
              />
            ))}
          </FlexWidget>
        ) : null}
        {view.name && small ? (
          <FlexWidget style={{ flexGap: 8 }}>
            {view.compactAmount ? (
              <FlexWidget style={{ flexGap: 4 }}>
                {text(
                  view.compactLabel! + (view.final ? SEPARATOR + 'final' : ''),
                  view.muted
                    ? t.textMuted
                    : view.compactLabel === 'You owe'
                      ? t.status.negative
                      : t.status.positive,
                  10,
                  true,
                )}
                {text(
                  view.compactAmount,
                  view.muted ? t.textMuted : t.text,
                  l.moneyFontSize,
                  true,
                  true,
                )}
                {view.currencyOverflow && !l.stackPayments
                  ? text(view.currencyOverflow, t.brand.main, 10, true)
                  : null}
              </FlexWidget>
            ) : (
              text(view.balance, balanceTone, 14, true)
            )}
            {view.people && l.showPeople ? text(view.people, t.textSecondary, 11) : null}
          </FlexWidget>
        ) : null}
        {view.state === 'all-square' && !small && l.showDescription ? (
          <FlexWidget
            style={{
              width: 'match_parent',
              flexDirection: 'row',
              alignItems: 'center',
              flexGap: 8,
            }}
          >
            {text('✓', t.status.positive, 20, true)}
            {text(view.description, t.textSecondary, 12)}
          </FlexWidget>
        ) : null}
        {view.hidden && l.showPrivacyLabel ? hiddenLabel(view.hidden, t) : null}
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
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  width: 'match_parent',
                  padding: 7,
                  flexGap: 12,
                }}
              >
                <FlexWidget
                  style={{ padding: 5, borderRadius: 8, backgroundColor: color(t.surface) }}
                >
                  {text(payment.initials, t.textSecondary, 10, true)}
                </FlexWidget>
                <FlexWidget style={{ flex: 1, flexGap: 2 }}>
                  {text(payment.label, t.text, 12)}
                  {l.stackPayments
                    ? text(
                        payment.amount,
                        view.muted ? t.textMuted : payment.incoming ? t.status.positive : t.text,
                        13,
                        true,
                        true,
                      )
                    : null}
                </FlexWidget>
                {!l.stackPayments
                  ? text(
                      payment.amount,
                      view.muted ? t.textMuted : payment.incoming ? t.status.positive : t.text,
                      13,
                      true,
                      true,
                    )
                  : null}
              </FlexWidget>
            ))}
          </FlexWidget>
        ) : null}
      </FlexWidget>
      <FlexWidget style={{ flex: 1 }} />
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: small || l.stackPayments ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexGap: 8,
        }}
      >
        {view.more ? (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={action({ kind: 'settle', groupId: setup.groupId })}
          >
            {text(view.more, t.brand.main, 10, true)}
          </FlexWidget>
        ) : view.action === 'Open to update' ? (
          text(view.action, t.textSecondary, 11)
        ) : null}
        {view.target === 'setup'
          ? button(view.action!, config)
          : view.target === 'sign-in'
            ? button('Sign in', 'sign-in')
            : view.addExpense
              ? button('＋ Add expense', { kind: 'expense', groupId: setup.groupId })
              : null}
      </FlexWidget>
    </FlexWidget>
  );
}
