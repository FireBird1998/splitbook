import { Platform } from 'react-native';
import { createWidgetsStore } from './widgets-native';

/** Android owns placement ids. Reconcile even in a build that disables the providers. */
export async function reconcileWidgetSetups() {
  if (Platform.OS !== 'android') return;
  const { getWidgetInfo } = await import('react-native-android-widget/src/api/get-widget-info');
  const placed = await Promise.all(['Balances', 'Group', 'Quick'].map(getWidgetInfo));
  await createWidgetsStore('').reconcileSetups(placed.flat().map((widget) => widget.widgetId));
}
