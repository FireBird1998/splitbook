import { mobileBuildSettings, widgetKey } from './config';
import { drawOverview } from './overview-widget-draw';
import { drawQuick } from './quick-widget-draw';
import { legacyBalancesSetup, widgetSetupRequired } from '@splitbook/shared/widget-setup';
import { drawWidgetSetup } from './widget-setup-draw';
import { personWidget } from '@splitbook/shared/person-widget';
import { drawPerson } from './person-widget-draw';
import { drawGroup } from './group-widget-draw';
// Narrow imports keep unused preview and setup UI out of the widget bundle.
import { registerWidgetTaskHandler } from 'react-native-android-widget/src/api/register-widget-task-handler';
import { getWidgetInfo } from 'react-native-android-widget/src/api/get-widget-info';
import { requestWidgetUpdateById } from 'react-native-android-widget/src/api/request-widget-update-by-id';
import type { WidgetInfo } from 'react-native-android-widget/src/api/types';
import { overviewWidget } from '@splitbook/shared/overview-widget';
import { lightTokens, darkTokens } from '@splitbook/shared/design-tokens';
import { createWidgetsStore } from './widgets-native';

const widgetStore = createWidgetsStore(widgetKey(mobileBuildSettings, __DEV__));

async function representation(info: WidgetInfo) {
  const record = await widgetStore.read();
  const { setup, unreadable } = await widgetStore.readSetup(info.widgetId);
  const size = { width: info.width, height: info.height, pixelRatio: info.screenInfo.density };
  if (unreadable) {
    const view = widgetSetupRequired(info.widgetId, size, info.screenInfo.fontScale);
    return { light: drawWidgetSetup(view, lightTokens), dark: drawWidgetSetup(view, darkTokens) };
  }
  if (info.widgetName === 'Quick') {
    const selected =
      setup?.kind === 'quick'
        ? setup
        : { kind: 'quick' as const, widgetId: info.widgetId, groupId: null, accountId: '' };
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
  if (info.widgetName === 'Person') {
    const selected =
      setup?.kind === 'person'
        ? setup
        : {
            kind: 'person' as const,
            widgetId: info.widgetId,
            accountId: '',
            person: { id: '', firstName: '', initials: '' },
          };
    const view = personWidget(
      record.copy,
      selected,
      size,
      record.session,
      Date.now(),
      info.screenInfo.fontScale,
    );
    return { light: drawPerson(view, lightTokens), dark: drawPerson(view, darkTokens) };
  }
  if (info.widgetName === 'Group') {
    const selected =
      setup?.kind === 'group'
        ? setup
        : {
            kind: 'group' as const,
            widgetId: info.widgetId,
            groupId: '',
            accountId: '',
          };
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
  const view = overviewWidget(
    record.copy,
    {
      kind: 'balances',
      widgetId: info.widgetId,
      hideAmounts: setup?.kind === 'balances' && setup.hideAmounts === true,
      reviewEnabled: process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true',
    },
    size,
    record.session,
    Date.now(),
    info.screenInfo.fontScale,
  );
  return { light: drawOverview(view, lightTokens), dark: drawOverview(view, darkTokens) };
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
      await Promise.all([
        getWidgetInfo('Balances'),
        getWidgetInfo('Group'),
        getWidgetInfo('Quick'),
        getWidgetInfo('Person'),
      ])
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
    if (!['Balances', 'Group', 'Quick', 'Person'].includes(widgetInfo.widgetName)) return;
    await serializeDraw(async () => {
      if (widgetInfo.widgetName === 'Balances' && widgetAction === 'WIDGET_UPDATE') {
        const { setup: saved, unreadable } = await widgetStore.readSetup(widgetInfo.widgetId);
        if (!saved && !unreadable) {
          const placed = (await getWidgetInfo('Balances')).some(
            (info) => info.widgetId === widgetInfo.widgetId,
          );
          const legacy = legacyBalancesSetup(widgetAction, widgetInfo.widgetId, saved, placed);
          if (legacy) await widgetStore.saveSetupIfAbsent(legacy);
        }
      }
      // WorkManager captures bounds before queuing an event. A later resize can overtake
      // it, while native drawing already uses the current bounds: project every resizable
      // widget from those same dimensions, falling back to a just-added event's bounds.
      const currentInfo =
        (await getWidgetInfo(widgetInfo.widgetName)).find(
          (info) => info.widgetId === widgetInfo.widgetId,
        ) ?? widgetInfo;
      if (currentInfo) renderWidget(await representation(currentInfo));
    });
  });
}
