import { expect, it, vi } from 'vitest';

const device = vi.hoisted(() => ({ reconcile: vi.fn(async () => undefined) }));
vi.mock('expo', () => ({ registerRootComponent: vi.fn() }));
vi.mock('../App', () => ({ default: () => null }));
vi.mock('./widget-lifecycle', () => ({ reconcileWidgetSetups: device.reconcile }));
vi.mock('./widgets-flag', () => ({ androidWidgetsEnabled: () => false }));
vi.mock('./notifications-flag', () => ({ androidNotificationsEnabled: () => false }));

it('reconciles placements at the real entry point even when widget registration is off', async () => {
  await import('../index');
  expect(device.reconcile).toHaveBeenCalledOnce();
});
