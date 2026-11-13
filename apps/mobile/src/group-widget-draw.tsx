import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';
import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import { groupWidget, type GroupWidgetSetup } from '@splitbook/shared/group-widget';
import type { WidgetDimensions } from '@splitbook/shared/widget-sizing';
import type { WidgetCopy, WidgetSession, WidgetTarget } from '@splitbook/shared/balances-widget';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import { widgetLink } from './widget-links';
import Constants from 'expo-constants';

export function drawGroup(
  copy: WidgetCopy | null,
  setup: GroupWidgetSetup,
  size: WidgetDimensions,
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
    l = view.layout;
  const color = (value: string) => value as `#${string}`;
  const action = (target: WidgetTarget) => ({
    uri: widgetLink(target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
  });
  const group = { kind: 'group' as const, groupId: setup.groupId };
  const config = { kind: 'setup' as const, widgetId: setup.widgetId };
  const target = view.target === 'setup' ? config : view.target === 'sign-in' ? 'sign-in' : group;
  const tone = view.muted
    ? t.textMuted
    : view.balanceTone === 'neutral'
      ? t.textSecondary
      : t.status[view.balanceTone];
  const text = (value: string, ink = t.text, fontSize = 12, bold = false, mono = false) => (
    <TextWidget
      text={value}
      maxLines={1}
      truncate="END"
      style={{
        color: color(ink),
        fontSize: fontSize * l.textFactor,
        fontWeight: bold ? 'bold' : 'normal',
        ...(mono ? { fontFamily: 'monospace' } : {}),
      }}
    />
  );
  const lines = (values: string[], ink = t.text, size = 12, bold = false) =>
    values.map((v, i) => <FlexWidget key={i}>{text(v, ink, size, bold)}</FlexWidget>);
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
    <FlexWidget style={{ padding: 6, borderRadius: 12, backgroundColor: color(t.brand.bg) }}>
      <SvgWidget
        svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="${themePath}" fill="none" stroke="${t.brand.main}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
        style={{ width: 20, height: 20 }}
      />
    </FlexWidget>
  );
  const header = (
    <FlexWidget
      style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', flexGap: 8 }}
    >
      {l.showTile ? mark : null}
      <FlexWidget style={{ flex: 1, flexGap: 3 }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <FlexWidget style={{ flex: 1 }}>
            {lines(l.nameLines, t.text, l.nameFontSize / l.textFactor, true)}
          </FlexWidget>
          {view.final ? (
            <FlexWidget
              style={{ backgroundColor: color(t.surfaceMuted), borderRadius: 6, padding: 3 }}
            >
              {text('Archived', t.textSecondary, 9, true)}
            </FlexWidget>
          ) : null}
        </FlexWidget>
        {l.compact
          ? l.showSaved && view.saved
            ? text(view.saved, t.textMuted, 9)
            : null
          : text(view.balance, tone, 11, true)}
      </FlexWidget>
      {!l.compact && l.showSaved && view.saved ? text(view.saved, t.textMuted, 9) : null}
    </FlexWidget>
  );
  const balance = view.compactAmount ? (
    <FlexWidget style={{ flexGap: 4 }}>
      <FlexWidget>{lines(l.balanceLabelLines, tone, 11, true)}</FlexWidget>
      {text(
        view.compactAmount,
        view.muted ? t.textMuted : t.text,
        l.moneyFontSize / l.textFactor,
        true,
        true,
      )}
      {l.showCurrencyOverflow && view.currencyOverflow
        ? text(view.currencyOverflow, t.brand.main, 10, true)
        : null}
    </FlexWidget>
  ) : (
    <FlexWidget>{lines(l.balanceLines, tone, 14, true)}</FlexWidget>
  );
  const payments = l.sections.find((s) => s.id === 'payments');
  const paymentRows = (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        borderRadius: 14,
        backgroundColor: color(t.surfaceMuted),
        paddingVertical: 4,
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
            width: 'match_parent',
            height: payments?.rowHeight,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: l.compact ? 0 : 7,
            flexGap: 8,
          }}
        >
          {!l.compact ? (
            <FlexWidget style={{ padding: 5, borderRadius: 8, backgroundColor: color(t.surface) }}>
              {text(payment.initials, t.textSecondary, 10, true)}
            </FlexWidget>
          ) : null}
          <FlexWidget style={{ flex: 1, flexGap: 2 }}>
            {text(payment.displayLabel, t.text, 12)}
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
  );
  const message = (
    <FlexWidget
      style={{ flexDirection: 'row', width: 'match_parent', flexGap: 12, alignItems: 'flex-start' }}
    >
      {l.showStateTile ? (
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
          <SvgWidget
            svg={
              view.state === 'signed-out'
                ? t.mode === 'dark'
                  ? darkMark
                  : lightMark
                : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><g fill="none" stroke="${t.textSecondary}" stroke-width="1.8">${view.state === 'expired' ? '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'}</g></svg>`
            }
            style={{ width: 24, height: 24 }}
          />
        </FlexWidget>
      ) : null}
      <FlexWidget style={{ flex: 1 }}>
        {lines(l.titleLines, t.text, l.compact ? 13 : 15, true)}
      </FlexWidget>
    </FlexWidget>
  );
  const buttonTarget =
    view.target === 'setup'
      ? config
      : view.target === 'sign-in'
        ? 'sign-in'
        : { kind: 'expense' as const, groupId: setup.groupId };
  const footer = (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: l.compact ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: l.compact ? 'flex-start' : 'space-between',
        flexGap: 4,
      }}
    >
      {l.showMore && view.more ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={action({ kind: 'settle', groupId: setup.groupId })}
        >
          {text(view.more, t.brand.main, 10, true)}
        </FlexWidget>
      ) : l.showUpdateInFooter ? (
        text(view.action!, t.textSecondary, 11)
      ) : !l.compact ? (
        <FlexWidget style={{ flex: 1 }} />
      ) : null}
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={action(buttonTarget)}
        style={{
          ...(l.compact ? { width: 'match_parent' as const } : {}),
          paddingHorizontal: l.actionPaddingHorizontal,
          paddingVertical: 9,
          backgroundColor: color(t.brand.bg),
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {lines(l.actionLines, t.brand.main, l.actionFontSize / l.textFactor, true)}
      </FlexWidget>
    </FlexWidget>
  );
  const content: Record<string, React.ReactNode> = {
    header,
    balance,
    payments: paymentRows,
    title: message,
    description: (
      <FlexWidget>{lines(l.descriptionLines, t.textSecondary, l.compact ? 10 : 12)}</FlexWidget>
    ),
    people: text(view.people ?? '', t.textSecondary, 11),
    more: text(view.more ?? '', t.brand.main, 10, true),
    hidden: text(view.hidden ?? '', t.textMuted, 10),
    action: footer,
    update: text(view.action ?? '', t.textSecondary, 11),
    loading: (
      <FlexWidget style={{ height: 'match_parent' }}>
        {l.loadingRows.map((row, index) => (
          <FlexWidget key={index} style={{ height: row.height, justifyContent: 'center' }}>
            <FlexWidget
              style={{
                width: row.width,
                height: 14,
                backgroundColor: color(t.surfaceMuted),
                borderRadius: 6,
              }}
            />
          </FlexWidget>
        ))}
      </FlexWidget>
    ),
  };
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={action(target)}
      accessibilityLabel={view.summary}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: l.padding,
        flexGap: l.gap,
        backgroundColor: color(t.surface),
        borderRadius: 24,
      }}
    >
      {l.sections.map((section) => (
        <FlexWidget
          key={section.id}
          style={{ height: section.height, width: 'match_parent', justifyContent: 'center' }}
        >
          {content[section.id]}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}
