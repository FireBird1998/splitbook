import { drawBalances } from './balances-widget-draw';
import { drawQuick } from './quick-widget-draw';
import { legacyBalancesSetup } from '@splitbook/shared/widget-setup';
import { drawGroup } from './group-widget-draw';
// Narrow imports keep unused preview and setup UI out of the widget bundle.
import { registerWidgetTaskHandler } from 'react-native-android-widget/src/api/register-widget-task-handler';
import { getWidgetInfo } from 'react-native-android-widget/src/api/get-widget-info';
import { requestWidgetUpdateById } from 'react-native-android-widget/src/api/request-widget-update-by-id';
import type { WidgetInfo } from 'react-native-android-widget/src/api/types';
import { balancesWidget } from '@splitbook/shared/balances-widget';
import { lightTokens, darkTokens } from '@splitbook/shared/design-tokens';
import { createWidgetsStore } from './widgets-native';

const widgetEnvironment = () => process.env.EXPO_PUBLIC_API_URL ?? '';
const widgetStore = createWidgetsStore(widgetEnvironment());

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
      light: drawQuick(
        record.copy,
        selected,
        size,
        record.session,
        lightTokens,
        info.screenInfo.fontScale,
      ),
      dark: drawQuick(
        record.copy,
        selected,
        size,
        record.session,
        darkTokens,
        info.screenInfo.fontScale,
      ),
    };
  }
  if (info.widgetName === 'Group') {
    const setup = await widgetStore.setup(info.widgetId);
    const selected =
      setup?.kind === 'group'
        ? setup
        : {
            kind: 'group' as const,
            widgetId: info.widgetId,
            groupId: '',
            accountId: '',
          };
    const size = info.width < 280 ? '2x2' : info.height >= 260 ? '4x3' : '4x2';
    return {
      light: drawGroup(
        record.copy,
        selected,
        size,
        record.session,
        Date.now(),
        lightTokens,
        info.screenInfo.fontScale,
      ),
      dark: drawGroup(
        record.copy,
        selected,
        size,
        record.session,
        Date.now(),
        darkTokens,
        info.screenInfo.fontScale,
      ),
    };
  }
  const setup = await widgetStore.setup(info.widgetId);
  const size = info.height < 130 ? '2x1' : info.width >= 280 ? '4x2' : '2x2';
  const view = balancesWidget(
    record.copy,
    {
      kind: 'balances',
      hideAmounts: setup?.kind === 'balances' && setup.hideAmounts === true,
      reviewEnabled: process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true',
    },
    size,
    record.session,
    Date.now(),
    info.screenInfo.fontScale,
  );
  return { light: drawBalances(view, lightTokens), dark: drawBalances(view, darkTokens) };
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
      await serializeDraw(async () => {
        await widgetStore.removeSetup(widgetInfo.widgetId);
      });
      return;
    }
    if (!['Balances', 'Group', 'Quick'].includes(widgetInfo.widgetName)) return;
    await serializeDraw(async () => {
      if (widgetInfo.widgetName === 'Balances' && widgetAction === 'WIDGET_UPDATE') {
        const saved = await widgetStore.setup(widgetInfo.widgetId);
        if (!saved) {
          const placed = (await getWidgetInfo('Balances')).some(
            (info) => info.widgetId === widgetInfo.widgetId,
          );
          const legacy = legacyBalancesSetup(widgetAction, widgetInfo.widgetId, saved, placed);
          if (legacy) await widgetStore.saveSetupIfAbsent(legacy);
        }
      }
      renderWidget(await representation(widgetInfo));
    });
  });
}
