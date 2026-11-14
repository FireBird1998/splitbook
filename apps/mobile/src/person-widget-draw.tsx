import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import Constants from 'expo-constants';
import type { PersonWidgetView } from '@splitbook/shared/person-widget';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import type { WidgetTarget } from '@splitbook/shared/balances-widget';
import { widgetLink } from './widget-links';
import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';

/** Native drawing consumes measured rows and sections; it makes no admission or sizing choices. */
export function drawPerson(view: PersonWidgetView, t: SemanticTokens) {
  const l = view.layout,
    f = l.fonts;
  const color = (value: string) => value as `#${string}`;
  const link = (target: WidgetTarget) => ({
    uri: widgetLink(target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
  });
  const text = (value: string, ink = t.text, size = f.label, bold = false, mono = false) => (
    <TextWidget
      text={value}
      maxLines={1}
      truncate="END"
      style={{
        color: color(ink),
        fontSize: size,
        fontWeight: bold ? 'bold' : 'normal',
        ...(mono ? { fontFamily: 'monospace' } : {}),
      }}
    />
  );
  const lines = (
    values: string[],
    ink = t.text,
    size = f.body,
    bold = false,
    align: 'flex-start' | 'center' = 'flex-start',
  ) =>
    values.map((value, i) => (
      <FlexWidget key={i} style={{ width: 'match_parent', alignItems: align }}>
        {text(value, ink, size, bold)}
      </FlexWidget>
    ));
  const header = (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 8 }}
    >
      {l.showAvatar ? (
        <FlexWidget
          style={{
            width: l.avatarSize,
            height: l.avatarSize,
            borderRadius: 10,
            backgroundColor: color(t.brand.bg),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {text(view.initials ?? '', t.brand.main, f.avatar, true)}
        </FlexWidget>
      ) : null}
      <FlexWidget style={{ flex: 1, flexGap: 3 }}>
        <TextWidget
          text={view.name ?? ''}
          maxLines={1}
          truncate="END"
          style={{
            width: 'match_parent',
            color: color(t.text),
            fontSize: f.name,
            fontWeight: 'bold',
          }}
        />
        {l.showGroups ? (
          <FlexWidget style={{ width: 'match_parent' }}>
            {lines(l.subtitleLines, t.textSecondary, f.small)}
          </FlexWidget>
        ) : null}
        {l.showSaved && !l.savedBeside ? text(view.saved ?? '', t.textMuted, f.saved) : null}
      </FlexWidget>
      {l.savedBeside ? text(view.saved ?? '', t.textMuted, f.saved) : null}
    </FlexWidget>
  );
  const payments = l.sections.find((section) => section.id === 'payments');
  const list = (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        paddingVertical: l.panelPadding,
        ...(!l.compact ? { backgroundColor: color(t.surfaceMuted), borderRadius: 14 } : {}),
      }}
    >
      {view.rows.map((row, i) => {
        const payment = row.kind === 'payment' ? row.payment : null;
        const amount = payment
          ? text(
              payment.amount,
              view.muted ? t.textMuted : payment.incoming ? t.status.positive : t.text,
              row.amountFont,
              true,
              true,
            )
          : null;
        return (
          <FlexWidget
            key={i}
            {...(payment ? { clickAction: 'OPEN_URI', clickActionData: link(payment.target) } : {})}
            style={{ height: row.height, width: 'match_parent' }}
          >
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
                height: row.contentHeight,
                width: 'match_parent',
                justifyContent: 'center',
                paddingHorizontal: l.compact ? 0 : 8,
                flexGap: 3,
              }}
            >
              {l.compact ? text(row.groupName, t.textSecondary, f.caption) : null}
              <FlexWidget
                style={{
                  width: 'match_parent',
                  flexDirection: 'row',
                  alignItems: 'center',
                  flexGap: 8,
                }}
              >
                <FlexWidget style={{ flex: 1 }}>
                  {text(
                    row.label,
                    l.compact
                      ? payment?.incoming
                        ? t.status.positive
                        : payment
                          ? t.status.negative
                          : t.status.positive
                      : t.text,
                    f.label,
                  )}
                </FlexWidget>
                {!row.stack ? amount : null}
              </FlexWidget>
              {row.stack ? amount : null}
              {!l.compact ? text(row.groupName, t.textSecondary, f.caption) : null}
            </FlexWidget>
          </FlexWidget>
        );
      })}
      {view.more ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            height: payments?.moreHeight,
            justifyContent: 'center',
            paddingHorizontal: l.compact ? 0 : 8,
          }}
        >
          {lines(l.moreLines, t.textSecondary, f.small)}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
  const icon =
    view.state === 'signed-out'
      ? t.mode === 'dark'
        ? darkMark
        : lightMark
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><g fill="none" stroke="${t.textSecondary}" stroke-width="1.8">${view.state === 'expired' ? '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>' : '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.7-3.8 3.4-6 7-6s6.3 2.2 7 6"/>'}</g></svg>`;
  const message = (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', flexGap: 12, alignItems: 'flex-start' }}
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
          <SvgWidget svg={icon} style={{ width: 28, height: 28 }} />
        </FlexWidget>
      ) : null}
      <FlexWidget style={{ flex: 1, flexGap: 8 }}>
        {l.titleLines.length ? (
          <FlexWidget style={{ width: 'match_parent' }}>
            {lines(l.titleLines, t.text, f.title, true)}
          </FlexWidget>
        ) : null}
        {l.descriptionLines.length ? (
          <FlexWidget style={{ width: 'match_parent' }}>
            {lines(l.descriptionLines, t.textSecondary, f.body)}
          </FlexWidget>
        ) : null}
      </FlexWidget>
    </FlexWidget>
  );
  const content: Record<string, React.ReactNode> = {
    header,
    payments: list,
    message,
    space: <FlexWidget />,
    loading: (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {l.loadingRows.map((row, i) => (
          <FlexWidget key={i} style={{ height: row.height, justifyContent: 'center' }}>
            <FlexWidget
              style={{
                width: row.width,
                height: 14,
                borderRadius: 6,
                backgroundColor: color(t.surfaceMuted),
              }}
            />
          </FlexWidget>
        ))}
      </FlexWidget>
    ),
    action: (
      <FlexWidget
        style={{ width: 'match_parent', alignItems: l.compact ? 'flex-start' : 'flex-end' }}
      >
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={link(view.target)}
          style={{
            ...(l.compact ? { width: 'match_parent' as const } : {}),
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: 14,
            backgroundColor: color(t.brand.bg),
            alignItems: 'center',
          }}
        >
          {lines(l.actionLines, t.brand.main, f.action, true, 'center')}
        </FlexWidget>
      </FlexWidget>
    ),
  };
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={link(view.target)}
      accessibilityLabel={view.summary}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: l.padding,
        flexGap: l.gap,
        borderRadius: 24,
        backgroundColor: color(t.surface),
      }}
    >
      {l.sections.map((section) => (
        <FlexWidget
          key={section.id}
          style={{ width: 'match_parent', height: section.height, justifyContent: 'center' }}
        >
          {content[section.id]}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}
