import { drawQuick } from './quick-widget-draw';
import { drawGroup } from './group-widget-draw';
// Narrow imports keep unused preview and setup UI out of the widget bundle.
import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { registerWidgetTaskHandler } from 'react-native-android-widget/src/api/register-widget-task-handler';
import { getWidgetInfo } from 'react-native-android-widget/src/api/get-widget-info';
import { requestWidgetUpdateById } from 'react-native-android-widget/src/api/request-widget-update-by-id';
import type { WidgetInfo } from 'react-native-android-widget/src/api/types';
import {
  balancesWidget,
  type BalancesWidgetView,
  type WidgetTarget,
} from '@splitbook/shared/balances-widget';
import { lightTokens, darkTokens, type SemanticTokens } from '@splitbook/shared/design-tokens';
import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';
import { createWidgetsStore } from './widgets-native';
import { widgetLink } from './widget-links';
import Constants from 'expo-constants';

const color = (value: string) => value as `#${string}`;
const uri = (target: WidgetTarget) => ({
  uri: widgetLink(target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
});
const widgetEnvironment = () => process.env.EXPO_PUBLIC_API_URL ?? '';
const widgetStore = createWidgetsStore(widgetEnvironment());

function draw(view: BalancesWidgetView, t: SemanticTokens) {
  const small = view.size === '2x1',
    wide = view.size === '4x2';
  const compactMoney = small && view.state === 'normal';
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
  const mark = (size = 18) => (
    <SvgWidget
      svg={t.mode === 'dark' ? darkMark : lightMark}
      style={{ width: size, height: size, marginRight: 6 }}
    />
  );
  const column = (title: string, lines: string[], overflow: string | null, tone: string) => (
    <FlexWidget
      style={{
        ...(wide
          ? {
              flex: 1,
              height: 'match_parent' as const,
              padding: 10,
              backgroundColor: color(t.surfaceMuted),
              borderRadius: 16,
            }
          : {}),
        flexGap: 2,
      }}
    >
      {text(title, tone, 11, true)}
      {lines.length
        ? lines.map((line, index) => (
            <TextWidget
              key={index}
              text={line}
              style={{
                color: color(view.muted ? t.textMuted : t.text),
                fontSize: small ? 19 : 16,
                fontWeight: 'bold',
                fontFamily: 'monospace',
              }}
            />
          ))
        : text('—', t.textMuted)}
      {overflow ? text(overflow, t.brand.main, 10, true) : null}
    </FlexWidget>
  );
  const chip = view.review ? (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={uri('review')}
      accessibilityLabel={view.review}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: color(t.brand.bg),
        borderRadius: 16,
      }}
    >
      {text(view.review, t.brand.main, 11, true)}
    </FlexWidget>
  ) : null;
  const summary = [
    'Balances',
    view.title,
    ...view.owed.map((v) => `You’re owed ${v}`),
    ...view.owe.map((v) => `You owe ${v}`),
    view.saved,
    view.description,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={uri(view.target)}
      accessibilityLabel={summary}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: small ? 12 : 14,
        backgroundColor: color(t.surface),
        borderRadius: 24,
        justifyContent: view.state === 'signed-out' ? 'center' : 'space-between',
      }}
    >
      {view.state !== 'signed-out' && (
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
            {mark(small ? 14 : 16)}
            {text(
              compactMoney ? (view.owed.length ? 'You’re owed' : 'You owe') : 'Balances',
              compactMoney ? (view.owed.length ? t.status.positive : t.status.negative) : t.text,
              small ? 10 : 11,
              true,
            )}
          </FlexWidget>
          {view.saved ? text(view.saved, view.muted ? t.status.warning : t.textMuted, 9) : null}
        </FlexWidget>
      )}
      {view.state === 'loading' ? (
        <FlexWidget style={{ flexGap: 10 }}>
          {(small ? [70, 120] : [70, 120, 60, 104]).map((width, index) => (
            <FlexWidget
              key={index}
              style={{
                width,
                height: index % 2 ? 16 : 10,
                backgroundColor: color(t.surfaceMuted),
                borderRadius: 6,
              }}
            />
          ))}
        </FlexWidget>
      ) : view.state !== 'normal' ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            flexGap: small ? 3 : 6,
            alignItems: view.state === 'signed-out' ? 'center' : 'flex-start',
          }}
        >
          {view.state === 'signed-out' ? (
            mark(small ? 20 : 30)
          ) : view.state === 'all-square' ? (
            text('✓', t.status.positive, small ? 16 : 24, true)
          ) : view.state === 'expired' ? (
            <SvgWidget
              svg={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="${t.textSecondary}" stroke-width="2"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></g></svg>`}
              style={{ width: small ? 16 : 24, height: small ? 16 : 24 }}
            />
          ) : null}
          {view.title ? text(view.title, t.text, small ? 12 : 14, true) : null}
          {view.description ? text(view.description, t.textSecondary, small ? 10 : 12) : null}
        </FlexWidget>
      ) : small ? (
        <FlexWidget style={{ flexGap: 2 }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 4 }}>
            {text(
              (view.owed.length ? view.owed : view.owe)[0] ?? '—',
              view.muted ? t.textMuted : t.text,
              19,
              true,
              true,
            )}
            {(view.owed.length ? view.owedOverflow : view.oweOverflow)
              ? text(
                  (view.owed.length ? view.owedOverflow : view.oweOverflow)!,
                  t.brand.main,
                  10,
                  true,
                )
              : null}
          </FlexWidget>
          {view.owed.length && view.owe.length ? (
            <FlexWidget style={{ flexDirection: 'row', flexGap: 6 }}>
              {text('You owe', t.status.negative, 10, true)}
              {text(view.owe[0]!, view.muted ? t.textMuted : t.text, 12, true, true)}
            </FlexWidget>
          ) : null}
        </FlexWidget>
      ) : (
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: wide ? 'row' : 'column',
            flexGap: wide ? 8 : 10,
          }}
        >
          {column('You’re owed', view.owed, view.owedOverflow, t.status.positive)}
          {column('You owe', view.owe, view.oweOverflow, t.status.negative)}
        </FlexWidget>
      )}
      {!small ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {view.state === 'no-groups' ? (
            <FlexWidget
              style={{ padding: 8, backgroundColor: color(t.brand.bg), borderRadius: 14 }}
            >
              {text('＋ Create a Group', t.brand.main, 12, true)}
            </FlexWidget>
          ) : view.muted ? (
            text('↻ Open to update', t.textMuted, 11)
          ) : (
            chip
          )}
          {view.footer && !view.muted ? text(view.footer, t.textSecondary, 10) : null}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
async function representation(info: WidgetInfo) {
  const record = await widgetStore.read();
  if (info.widgetName === 'Quick') {
    const setup = await widgetStore.setup(info.widgetId);
    const selected =
      setup?.kind === 'quick'
        ? setup
        : { kind: 'quick' as const, widgetId: info.widgetId, groupId: null, accountId: '' };
    const size = info.width < 160 ? '1x1' : '2x1';
    return {
      light: drawQuick(record.copy, selected, size, record.session, lightTokens),
      dark: drawQuick(record.copy, selected, size, record.session, darkTokens),
    };
  }
  if (info.widgetName === 'Group') {
    const setup = await widgetStore.setup(info.widgetId);
    const selected = (setup?.kind === 'group' ? setup : null) ?? {
      kind: 'group' as const,
      widgetId: info.widgetId,
      groupId: '',
      accountId: '',
    };
    const size = info.width < 280 ? '2x2' : info.height >= 260 ? '4x3' : '4x2';
    return {
      light: drawGroup(record.copy, selected, size, record.session, Date.now(), lightTokens),
      dark: drawGroup(record.copy, selected, size, record.session, Date.now(), darkTokens),
    };
  }
  const size = info.height < 130 ? '2x1' : info.width >= 280 ? '4x2' : '2x2';
  const view = balancesWidget(
    record.copy,
    {
      kind: 'balances',
      reviewEnabled: process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true',
    },
    size,
    record.session,
    Date.now(),
  );
  return { light: draw(view, lightTokens), dark: draw(view, darkTokens) };
}
let drawing: Promise<void> = Promise.resolve();
const serializeDraw = (run: () => Promise<void>) => {
  const next = drawing.catch(() => undefined).then(run);
  drawing = next;
  return next;
};
export function redrawBalances() {
  return serializeDraw(async () => {
    const widgets = (
      await Promise.all([getWidgetInfo('Balances'), getWidgetInfo('Group'), getWidgetInfo('Quick')])
    ).flat();
    await Promise.all(
      widgets.map((info) =>
        requestWidgetUpdateById({
          widgetName: info.widgetName,
          widgetId: info.widgetId,
          renderWidget: representation,
        }),
      ),
    );
  });
}
export function registerAndroidWidgets() {
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (widgetAction === 'WIDGET_DELETED') {
      await widgetStore.removeSetup(widgetInfo.widgetId);
      return;
    }
    if (!['Balances', 'Group', 'Quick'].includes(widgetInfo.widgetName)) return;
    await serializeDraw(async () => {
      renderWidget(await representation(widgetInfo));
    });
  });
}
