import { widgetThemeIcon } from './widget-theme-icon';
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
  const view = groupWidget(
      part,
      setup,
      size,
      session,
      now,
      fontScale,
      copy?.accountId === setup.accountId ? copy.months?.[setup.groupId] : undefined,
      copy?.accountId === setup.accountId ? copy.recents?.[setup.groupId] : undefined,
    ),
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
  const text = (
    value: string,
    ink = t.text,
    fontSize = l.fontSizes.body,
    bold = false,
    mono = false,
  ) => (
    <TextWidget
      text={value}
      maxLines={1}
      truncate="END"
      style={{
        color: color(ink),
        fontSize,
        fontWeight: bold ? 'bold' : 'normal',
        ...(mono ? { fontFamily: 'monospace' } : {}),
      }}
    />
  );
  const lines = (values: string[], ink = t.text, size = l.fontSizes.body, bold = false) =>
    values.map((v, i) => <FlexWidget key={i}>{text(v, ink, size, bold)}</FlexWidget>);
  const mark = (
    <FlexWidget style={{ padding: 6, borderRadius: 12, backgroundColor: color(t.brand.bg) }}>
      {widgetThemeIcon(view.theme, t.brand.main)}
    </FlexWidget>
  );
  const header = (
    <FlexWidget
      style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', flexGap: 8 }}
    >
      {l.showTile ? mark : null}
      <FlexWidget style={{ flex: 1, flexGap: 3 }}>
        <FlexWidget
          style={{
            ...(l.stackHeader ? { width: 'match_parent' as const } : {}),
            flexDirection: l.stackHeader ? 'column' : 'row',
            alignItems: l.stackHeader ? 'flex-start' : 'center',
            flexGap: 6,
          }}
        >
          <FlexWidget style={l.stackHeader ? { width: 'match_parent' } : { flex: 1 }}>
            {l.nameLines.map((name, index) => (
              <TextWidget
                key={index}
                text={name}
                maxLines={1}
                truncate="END"
                style={{
                  width: 'match_parent',
                  color: color(t.text),
                  fontSize: l.nameFontSize,
                  fontWeight: 'bold',
                }}
              />
            ))}
          </FlexWidget>
          {l.tripDay ? (
            <FlexWidget
              style={{
                backgroundColor: color(t.surfaceMuted),
                borderRadius: 12,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              {text(l.tripDay, t.textSecondary, l.fontSizes.secondary, true)}
            </FlexWidget>
          ) : null}
          {l.showArchivedTag ? (
            <FlexWidget
              style={{ backgroundColor: color(t.surfaceMuted), borderRadius: 6, padding: 3 }}
            >
              {text('Archived', t.textSecondary, l.fontSizes.caption, true)}
            </FlexWidget>
          ) : null}
        </FlexWidget>
        {l.compact
          ? l.showSaved && view.saved
            ? text(view.saved, t.textMuted, l.fontSizes.caption)
            : null
          : text(l.hiddenHeaderBalance ?? view.balance, tone, l.fontSizes.secondary, true)}
      </FlexWidget>
      {!l.compact && l.showSaved && view.saved
        ? text(view.saved, t.textMuted, l.fontSizes.caption)
        : null}
    </FlexWidget>
  );
  const balance = view.compactAmount ? (
    <FlexWidget style={{ flexGap: 4 }}>
      <FlexWidget>{lines(l.balanceLabelLines, tone, l.fontSizes.secondary, true)}</FlexWidget>
      {text(view.compactAmount, view.muted ? t.textMuted : t.text, l.moneyFontSize, true, true)}
      {l.showCurrencyOverflow && view.currencyOverflow
        ? text(view.currencyOverflow, t.brand.main, l.fontSizes.small, true)
        : null}
    </FlexWidget>
  ) : (
    <FlexWidget>{lines(l.balanceLines, tone, l.balanceFontSize, true)}</FlexWidget>
  );
  const payments = l.sections.find((s) => s.id === 'payments');
  const paymentPanel = (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: l.paymentPanelHeight,
        ...(!l.compact ? { borderRadius: 14, backgroundColor: color(t.surfaceMuted) } : {}),
        paddingVertical: l.paymentPadding,
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
            height: l.paymentRows[index]!.height,
          }}
        >
          {l.paymentRows[index]!.dividerHeight ? (
            <FlexWidget
              style={{
                width: 'match_parent',
                height: l.paymentRows[index]!.dividerHeight,
                backgroundColor: color(t.border),
              }}
            />
          ) : null}
          <FlexWidget
            style={{
              width: 'match_parent',
              height: l.paymentRows[index]!.contentHeight,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: l.compact ? 0 : 7,
              flexGap: 8,
            }}
          >
            {!l.compact ? (
              <FlexWidget
                style={{ padding: 5, borderRadius: 8, backgroundColor: color(t.surface) }}
              >
                {text(payment.initials, t.textSecondary, l.fontSizes.small, true)}
              </FlexWidget>
            ) : null}
            <FlexWidget style={{ flex: 1, flexGap: 2 }}>
              {text(payment.displayLabel, t.text, l.paymentFontSize)}
              {l.stackPayments
                ? text(
                    payment.amount,
                    view.muted ? t.textMuted : payment.incoming ? t.status.positive : t.text,
                    l.fontSizes.paymentAmount,
                    true,
                    true,
                  )
                : null}
            </FlexWidget>
            {!l.stackPayments
              ? text(
                  payment.amount,
                  view.muted ? t.textMuted : payment.incoming ? t.status.positive : t.text,
                  l.fontSizes.paymentAmount,
                  true,
                  true,
                )
              : null}
          </FlexWidget>
        </FlexWidget>
      ))}
      {l.showMore && !l.moreInFooter && view.more ? (
        <FlexWidget style={{ height: payments?.moreHeight, justifyContent: 'center' }}>
          {lines(l.moreLines, t.textSecondary, l.fontSizes.small, true)}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
  const paymentRows = (
    <FlexWidget style={{ width: 'match_parent', height: 'match_parent' }}>
      {l.paymentLabel ? (
        <FlexWidget style={{ height: l.sectionLabelHeight }}>
          {text(l.paymentLabel, t.textSecondary, l.fontSizes.secondary, true)}
        </FlexWidget>
      ) : null}
      {paymentPanel}
    </FlexWidget>
  );
  const month = (
    <FlexWidget style={{ width: 'match_parent' }}>
      {l.monthLabel ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            height: l.sectionLabelHeight,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <FlexWidget style={{ flex: 1 }}>
            {text(l.monthLabel, t.textSecondary, l.fontSizes.secondary, true)}
          </FlexWidget>
          {l.monthSaved ? text(l.monthSaved, t.textMuted, l.fontSizes.caption) : null}
        </FlexWidget>
      ) : null}
      {view.month?.prompt || view.month?.count ? (
        <FlexWidget>
          {lines(
            l.monthPromptLines,
            view.month?.prompt ? t.brand.main : t.textSecondary,
            l.fontSizes.secondary,
          )}
        </FlexWidget>
      ) : (
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: l.compact ? 'column' : 'row',
            flexGap: l.monthColumnGap,
          }}
        >
          {view.month?.totals.length || view.month?.more ? (
            <FlexWidget
              style={{
                ...(l.compact ? { width: 'match_parent' as const } : { flex: 1 }),
                height: l.monthCardHeight,
                padding: l.monthPanelPadding,
                borderRadius: 12,
                backgroundColor: color(t.surfaceMuted),
              }}
            >
              {text('Group spent', t.textSecondary, l.fontSizes.secondary)}
              <FlexWidget style={{ height: 4 }} />
              {view.month.totals.map((amount, index) => (
                <FlexWidget key={index}>
                  {text(amount, t.text, l.monthAmountFontSize, true, true)}
                </FlexWidget>
              ))}
              {view.month?.more ? (
                <FlexWidget style={{ paddingTop: 4 }}>
                  {lines(l.monthMoreLines, t.textSecondary, l.fontSizes.small)}
                </FlexWidget>
              ) : null}
            </FlexWidget>
          ) : null}
          {view.month?.share ? (
            <FlexWidget
              style={{
                ...(l.compact ? { width: 'match_parent' as const } : { flex: 1 }),
                height: l.monthCardHeight,
                padding: l.monthPanelPadding,
                borderRadius: 12,
                backgroundColor: color(t.surfaceMuted),
              }}
            >
              {text('Your share', t.textSecondary, l.fontSizes.secondary)}
              <FlexWidget style={{ height: 4 }} />
              {text(view.month.share, t.text, l.monthAmountFontSize, true, true)}
              {l.monthNoteLines.length ? (
                <FlexWidget style={{ paddingTop: 4 }}>
                  {lines(l.monthNoteLines, t.textMuted, l.fontSizes.small)}
                </FlexWidget>
              ) : null}
            </FlexWidget>
          ) : null}
        </FlexWidget>
      )}
    </FlexWidget>
  );
  const recent = (
    <FlexWidget style={{ width: 'match_parent' }}>
      {l.recentLabel ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            height: l.sectionLabelHeight,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <FlexWidget style={{ flex: 1 }}>
            {text(l.recentLabel, t.textSecondary, l.fontSizes.secondary, true)}
          </FlexWidget>
          {l.recentSaved ? text(l.recentSaved, t.textMuted, l.fontSizes.caption) : null}
        </FlexWidget>
      ) : null}
      <FlexWidget
        style={{
          width: 'match_parent',
          height: l.recentPanelHeight,
          ...(!l.compact && view.recent?.rows.length
            ? { borderRadius: 14, backgroundColor: color(t.surfaceMuted) }
            : {}),
          paddingVertical: view.recent?.rows.length && !l.compact ? l.paymentPadding : 0,
        }}
      >
        {view.recent?.rows.map((row, index) => (
          <FlexWidget
            key={row.id}
            clickAction="OPEN_URI"
            clickActionData={action({ kind: 'expenses', groupId: setup.groupId })}
            style={{ width: 'match_parent', height: l.recentRowSizes[index]!.height }}
          >
            {l.recentRowSizes[index]!.dividerHeight ? (
              <FlexWidget
                style={{
                  width: 'match_parent',
                  height: l.recentRowSizes[index]!.dividerHeight,
                  backgroundColor: color(t.border),
                }}
              />
            ) : null}
            <FlexWidget
              style={{
                width: 'match_parent',
                height: l.recentRowSizes[index]!.contentHeight,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: l.compact ? 0 : 7,
                flexGap: 8,
              }}
            >
              {!l.compact ? (
                <FlexWidget
                  style={{
                    width: 24,
                    height: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    backgroundColor: color(t.surface),
                  }}
                >
                  <SvgWidget
                    svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="${t.textSecondary}" stroke-width="1.6">${row.kind === 'settlement' ? '<path d="M16 4l4 4-4 4M20 8H8M8 20l-4-4 4-4M4 16h12"/>' : '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8.5h6M9 12.5h6"/>'}</g></svg>`}
                    style={{ width: 14, height: 14 }}
                  />
                </FlexWidget>
              ) : null}
              <FlexWidget style={{ flex: 1, flexGap: 2 }}>
                {text(row.description, t.text, l.fontSizes.body)}
                {text(row.detail, t.textMuted, l.fontSizes.small)}
              </FlexWidget>
              {text(row.amount, t.text, l.recentAmountFontSize, true, true)}
            </FlexWidget>
          </FlexWidget>
        ))}
        {l.recentMessageLines.length ? (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={action({ kind: 'expenses', groupId: setup.groupId })}
            style={{
              paddingHorizontal: l.compact ? 0 : 12,
              height: l.recentPanelHeight,
              justifyContent: 'center',
            }}
          >
            {lines(
              l.recentMessageLines,
              t.textSecondary,
              l.fontSizes.secondary,
              !!view.recent?.prompt,
            )}
          </FlexWidget>
        ) : null}
        {view.recent?.more ? (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={action({ kind: 'expenses', groupId: setup.groupId })}
            style={{ height: l.recentMoreHeight, justifyContent: 'center' }}
          >
            {text(
              view.recent.more,
              l.recentMoreIsCount ? t.textSecondary : t.brand.main,
              l.fontSizes.small,
            )}
          </FlexWidget>
        ) : null}
      </FlexWidget>
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
        {lines(l.titleLines, t.text, l.titleFontSize, true)}
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
      {l.showMore && l.moreInFooter && view.more ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={action({ kind: 'settle', groupId: setup.groupId })}
        >
          {text(
            view.more,
            l.paymentLines ? t.brand.main : t.textSecondary,
            l.fontSizes.small,
            true,
          )}
        </FlexWidget>
      ) : l.showUpdateInFooter ? (
        text(view.action!, t.textSecondary, l.fontSizes.secondary)
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
        {lines(l.actionLines, t.brand.main, l.actionFontSize, true)}
      </FlexWidget>
    </FlexWidget>
  );
  const content: Record<string, React.ReactNode> = {
    header,
    balance,
    payments: paymentRows,
    recent,
    counts: (
      <FlexWidget
        style={{
          width: 'match_parent',
          height: l.hiddenCountsHeight,
          borderRadius: 14,
          backgroundColor: color(t.surfaceMuted),
          paddingVertical: 4,
        }}
      >
        {l.hiddenCountRows.map((row, index) => (
          <FlexWidget key={index} style={{ width: 'match_parent', height: row.height }}>
            {row.dividerHeight ? (
              <FlexWidget
                style={{
                  height: row.dividerHeight,
                  width: 'match_parent',
                  backgroundColor: color(t.border),
                }}
              />
            ) : null}
            <FlexWidget
              style={{
                height: row.height - row.dividerHeight,
                paddingHorizontal: 12,
                justifyContent: 'center',
              }}
            >
              {lines(row.lines, t.textSecondary, l.fontSizes.secondary)}
            </FlexWidget>
          </FlexWidget>
        ))}
      </FlexWidget>
    ),
    month,
    title: message,
    description: (
      <FlexWidget>
        {lines(
          l.descriptionLines,
          t.textSecondary,
          l.compact ? l.fontSizes.small : l.fontSizes.body,
        )}
      </FlexWidget>
    ),
    hidden: text(view.hidden ?? '', t.textMuted, l.fontSizes.small),
    action: footer,
    update: text(view.action ?? '', t.textSecondary, l.fontSizes.secondary),
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
        paddingHorizontal: l.padding,
        paddingVertical: l.paddingVertical,
        flexGap: l.gap,
        backgroundColor: color(t.surface),
        borderRadius: l.cornerRadius,
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
