import { z } from 'zod';
import { RequestError, Superseded, type RequestOptions } from './transport';
export interface NotificationNative {
  installation(): Promise<{ id: string; key: string }>;
  permission(): Promise<'granted' | 'denied' | 'blocked'>;
  requestPermission(): Promise<'granted' | 'denied' | 'blocked'>;
  token(): Promise<string>;
  clear(): Promise<void>;
  openSettings(): Promise<void>;
}
const preferences = z.object({
  available: z.boolean(),
  enabled: z.boolean(),
  expenseUpdates: z.boolean(),
  payments: z.boolean(),
  revision: z.number().int().nonnegative(),
  activation: z.string().nullable(),
  binding: z.string().nullable().optional(),
  expenseActivation: z.string().nullable().optional(),
  expenseCutoff: z.string().nullable(),
  paymentCutoff: z.string().nullable(),
});
export type NotificationPreferences = z.infer<typeof preferences>;
export interface NotificationControls {
  status: 'off' | 'loading' | 'pending' | 'ready' | 'offline' | 'denied' | 'blocked' | 'error';
  confirmed: NotificationPreferences;
  message: string;
}
export const emptyNotifications = (): NotificationControls => ({
  status: 'off',
  confirmed: {
    available: false,
    enabled: false,
    expenseUpdates: false,
    payments: false,
    revision: 0,
    activation: null,
    expenseCutoff: null,
    paymentCutoff: null,
  },
  message: '',
});
/** Operation state lives solely in the controller snapshot. Tokens exist only inside a live command. */
export function notificationControls(d: {
  native?: NotificationNative;
  owner: () => number;
  current: (owner: number) => boolean;
  authenticated: () => boolean;
  online: () => boolean;
  state: () => NotificationControls;
  publish: (state: NotificationControls) => void;
  request: (path: string, owner: number, options?: RequestOptions) => Promise<unknown>;
}) {
  let operation = 0;
  // A retiring account's native cleanup must finish before another account obtains a token.
  let cleanup: Promise<void> = Promise.resolve();
  let cleanupFailed = false;
  const clearNative = () => {
    cleanup = cleanup
      .catch(() => undefined)
      .then(async () => {
        try {
          await d.native?.clear();
          cleanupFailed = false;
        } catch (error) {
          cleanupFailed = true;
          throw error;
        }
      });
    void cleanup.catch(() => undefined);
    return cleanup;
  };
  let retry: (() => Promise<void>) | null = null;
  const active = (owner: number, task: number) =>
    d.current(owner) && operation === task && d.authenticated();
  const set = (status: NotificationControls['status'], message = '') =>
    d.publish({ ...d.state(), status, message });
  const result = (value: unknown) =>
    preferences.parse(z.object({ data: preferences }).parse(value).data);
  const failed = (error: unknown) => {
    if (error instanceof Superseded) return;
    set(
      error instanceof RequestError && ['network', 'timeout'].includes(error.kind)
        ? 'offline'
        : 'error',
      error instanceof RequestError && ['network', 'timeout'].includes(error.kind)
        ? 'Connect to confirm notification settings.'
        : 'Couldn’t confirm notification settings. Retry.',
    );
  };
  const read = async () => {
    if (!d.native || !d.authenticated() || d.state().status === 'pending') return;
    const owner = d.owner(),
      task = ++operation;
    set('loading');
    try {
      await cleanup;
      if (!active(owner, task)) return;
      const installation = await d.native.installation();
      if (!active(owner, task)) return;
      const value = await d.request(
        '/api/notifications/device?installationId=' + installation.id,
        owner,
        { installationKey: installation.key },
      );
      if (!active(owner, task)) return;
      const confirmed = result(value);
      const permission = await d.native.permission();
      if (!active(owner, task)) return;
      d.publish({
        confirmed,
        status: confirmed.enabled && permission !== 'granted' ? 'blocked' : 'ready',
        message:
          confirmed.enabled && permission !== 'granted'
            ? 'Android blocks notifications. Open Android settings to allow them.'
            : '',
      });
      retry = null;
    } catch (error) {
      if (active(owner, task)) {
        retry = read;
        failed(error);
      }
    }
  };
  const change = async (
    enabled: boolean,
    category?: 'expenseUpdates' | 'payments',
    value?: boolean,
    explicit = false,
  ) => {
    if (!d.native || !d.authenticated() || d.state().status === 'pending') return;
    const requestedBy = d.owner();
    const repeat = async () => {
      await read();
      if (!d.current(requestedBy) || !d.authenticated()) return;
      if (['ready', 'blocked'].includes(d.state().status))
        await change(enabled, category, value, false);
      else retry = repeat;
    };
    retry = repeat;
    if (!d.online()) {
      set('offline', 'Connect to confirm notification settings.');
      return;
    }
    const owner = d.owner(),
      task = ++operation;
    const prior = d.state().confirmed;
    set('pending', 'Confirming notification settings…');
    try {
      await cleanup;
      if (!active(owner, task)) return;
      const installation = await d.native.installation();
      if (!active(owner, task)) return;
      let token: string | undefined;
      let permission: 'granted' | 'denied' | 'blocked' = 'granted';
      if (enabled && !category) {
        permission = explicit ? await d.native.requestPermission() : await d.native.permission();
        if (!active(owner, task)) return;
        if (permission !== 'granted') {
          set(
            permission === 'blocked' ? 'blocked' : 'denied',
            permission === 'blocked'
              ? 'Android blocks notifications. Open Android settings to allow them.'
              : 'Permission wasn’t granted. You can enable notifications when you’re ready.',
          );
          retry = null;
          return;
        }
        token = await d.native.token();
        if (!active(owner, task)) return;
      }
      if (enabled && category) {
        permission = await d.native.permission();
        if (!active(owner, task)) return;
      }
      const body = {
        installationId: installation.id,
        installationKey: installation.key,
        revision: prior.revision,
        enabled,
        ...(category
          ? { expenseUpdates: prior.expenseUpdates, payments: prior.payments, [category]: value }
          : {}),
        ...(token ? { token } : {}),
      };
      const confirmed = result(
        await d.request('/api/notifications/device', owner, { method: 'POST', body }),
      );
      if (!active(owner, task)) return;
      d.publish({
        confirmed,
        status: enabled && permission !== 'granted' ? 'blocked' : 'ready',
        message:
          enabled && permission !== 'granted'
            ? 'Android blocks notifications. Open Android settings to allow them.'
            : '',
      });
      retry = null;
      if (!enabled) await clearNative();
    } catch (error) {
      if (active(owner, task)) failed(error);
    }
  };
  return {
    read,
    enable: () => change(true, undefined, undefined, true),
    disable: () => change(false),
    category: (category: 'expenseUpdates' | 'payments', value: boolean) =>
      d.state().confirmed.enabled ? change(true, category, value) : Promise.resolve(),
    retry: async () => {
      const owner = d.owner();
      if (cleanupFailed) {
        try {
          await clearNative();
        } catch (error) {
          if (d.current(owner)) failed(error);
          return;
        }
      }
      if (d.current(owner)) await (retry ? retry() : read());
    },
    openSettings: async () => {
      try {
        await d.native?.openSettings();
      } catch {
        set('error', 'Couldn’t open Android settings. Retry.');
      }
    },
    reset: () => {
      operation++;
      retry = null;
      void clearNative().catch(() => undefined);
    },
  };
}
