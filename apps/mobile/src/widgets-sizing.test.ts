import { afterEach, expect, it, vi } from 'vitest';
import type { WidgetTaskHandler } from 'react-native-android-widget/src/api/register-widget-task-handler';
const native = vi.hoisted(() => ({
  handler: null as WidgetTaskHandler | null,
  drawQuick: vi.fn<(...args: unknown[]) => null>(),
  drawGroup: vi.fn<(...args: unknown[]) => null>(),
  getWidgetInfo: vi.fn(),
}));
vi.mock('./config', () => ({ mobileBuildSettings: {}, widgetKey: () => 'development' }));
vi.mock('./person-widget-draw', () => ({ drawPerson: vi.fn() }));
vi.mock('./group-widget-draw', () => ({ drawGroup: native.drawGroup }));
vi.mock('./overview-widget-draw', () => ({ drawOverview: vi.fn() }));
vi.mock('./quick-widget-draw', () => ({ drawQuick: native.drawQuick }));
vi.mock('./widgets-native', () => ({
  createWidgetsStore: () => ({
    read: async () => ({ copy: null, session: { status: 'signed-out' } }),
    setup: async () => ({ kind: 'group', widgetId: 7, accountId: 'alex', groupId: 'maple' }),
  }),
}));
vi.mock('react-native-android-widget/src/api/register-widget-task-handler', () => ({
  registerWidgetTaskHandler: (handler: WidgetTaskHandler) => {
    native.handler = handler;
  },
}));
vi.mock('react-native-android-widget/src/api/get-widget-info', () => ({
  getWidgetInfo: native.getWidgetInfo,
}));
vi.mock('react-native-android-widget/src/api/request-widget-update-by-id', () => ({
  requestWidgetUpdateById: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('draws a queued Group resize at the current native dimensions rather than its earlier event size', async () => {
  vi.stubGlobal('__DEV__', false);
  const { registerAndroidWidgets } = await import('./widgets');
  const info = {
    widgetName: 'Group',
    widgetId: 7,
    width: 360,
    height: 584,
    screenInfo: {
      fontScale: 1,
      density: 2.625,
      densityDpi: 420,
      screenWidthDp: 411,
      screenHeightDp: 914,
    },
  };
  native.getWidgetInfo.mockResolvedValue([info]);
  registerAndroidWidgets();
  const renderWidget = vi.fn();
  await native.handler!({
    widgetInfo: { ...info, height: 224 },
    widgetAction: 'WIDGET_RESIZED',
    renderWidget,
  });
  expect(native.drawGroup.mock.calls.map((args) => args[2])).toEqual([
    { width: 360, height: 584, pixelRatio: 2.625 },
    { width: 360, height: 584, pixelRatio: 2.625 },
  ]);
  expect(renderWidget).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it('uses the event size when a just-added Group widget is not listed by native yet', async () => {
  vi.stubGlobal('__DEV__', false);
  const { registerAndroidWidgets } = await import('./widgets');
  native.getWidgetInfo.mockResolvedValue([]);
  registerAndroidWidgets();
  const renderWidget = vi.fn();
  await native.handler!({
    widgetInfo: {
      widgetName: 'Group',
      widgetId: 7,
      width: 360,
      height: 224,
      screenInfo: {
        fontScale: 1,
        density: 2.625,
        densityDpi: 420,
        screenWidthDp: 411,
        screenHeightDp: 914,
      },
    },
    widgetAction: 'WIDGET_RESIZED',
    renderWidget,
  });
  expect(renderWidget).toHaveBeenCalledOnce();
  expect(native.drawGroup.mock.calls.map((args) => args[2])).toEqual([
    { width: 360, height: 224, pixelRatio: 2.625 },
    { width: 360, height: 224, pixelRatio: 2.625 },
  ]);
});

it('projects Quick actions from the latest native width, height and density', async () => {
  vi.stubGlobal('__DEV__', false);
  const { registerAndroidWidgets } = await import('./widgets');
  const info = {
    widgetName: 'Quick',
    widgetId: 8,
    width: 172,
    height: 224,
    screenInfo: {
      fontScale: 1.3,
      density: 2.625,
      densityDpi: 420,
      screenWidthDp: 411,
      screenHeightDp: 914,
    },
  };
  native.getWidgetInfo.mockResolvedValue([info]);
  registerAndroidWidgets();
  const renderWidget = vi.fn();
  await native.handler!({
    widgetInfo: { ...info, height: 104 },
    widgetAction: 'WIDGET_RESIZED',
    renderWidget,
  });
  expect(native.drawQuick.mock.calls.map((args) => args[2])).toEqual([
    { width: 172, height: 224, pixelRatio: 2.625 },
    { width: 172, height: 224, pixelRatio: 2.625 },
  ]);
  expect(renderWidget).toHaveBeenCalledOnce();
});
