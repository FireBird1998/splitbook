import { z } from 'zod';
import { RequestError, Superseded, type RequestOptions } from './transport';
import type { MobileTimer } from './types';
export interface NotificationNative {
  installation(): Promise<{ id: string; key: string }>;
  permission(): Promise<'granted' | 'denied' | 'blocked'>;
  requestPermission(): Promise<'granted' | 'denied' | 'blocked'>;
  token(): Promise<string>;
  /** Calls `listener` with each new Android token; returns what stops listening. */
  onToken?(listener: (token: string) => void): () => void;
  clear(): Promise<void>;
  openSettings(): Promise<void>;
}
/** Registration maintenance tries at most three times, waiting this long before each retry. */
export const maintenanceRetryDelays = [2_000, 8_000] as const;
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
/** A `GET /api/notifications/device` answer's confirmed controls; throws on anything else. */
export const parseNotificationPreferences = (value: unknown): NotificationPreferences =>
  preferences.parse(z.object({ data: preferences }).parse(value).data);
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
  timer?: MobileTimer;
}) {
  let operation = 0;
  const timer: MobileTimer =
    d.timer ??
    ((run, ms) => {
      const timeout = setTimeout(run, ms);
      return () => clearTimeout(timeout);
    });
  // Registration maintenance (#844): its own generation, so a Settings read never cancels it,
  // while a member's change, a session change or disposal always does.
  let maintenance = 0;
  let wake: (() => void) | null = null;
  // A maintenance POST in flight: a member's change waits for its answer, so both use one revision.
  let maintenanceFlight: Promise<unknown> = Promise.resolve();
  // Maintenance a member's change interrupted, or that found one pending: it runs after the change.
  let maintenanceWanted = false;
  let maintaining: number | null = null;
  const stopMaintenance = () => {
    maintenance++;
    if (maintaining !== null) maintenanceWanted = true;
    wake?.();
  };
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const cancel = timer(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        wake = null;
        cancel();
        resolve();
      };
    });
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
  const result = parseNotificationPreferences;
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
    stopMaintenance();
    set('pending', 'Confirming notification settings…');
    try {
      await cleanup;
      await maintenanceFlight.catch(() => undefined);
      if (!active(owner, task)) return;
      const prior = d.state().confirmed;
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
      // An explicit Enable registered a fresh token itself; a category change resumes maintenance.
      const resume = maintenanceWanted && enabled && !!category;
      maintenanceWanted = false;
      if (resume) void maintain();
      if (!enabled) await clearNative();
    } catch (error) {
      if (active(owner, task)) failed(error);
    }
  };
  /**
   * Keeps this phone's registration current (#844): after the same session is restored, or with
   * a new native `token`. Only a phone whose confirmed controls are on for this session and whose
   * Android permission is granted uploads its token, and never with a permission prompt: the
   * server refuses it for any other binding. A network or server failure is retried at most
   * twice; a session change, a member's change or disposal ends it, late results included.
   */
  const maintain = async (given?: string): Promise<void> => {
    if (!d.native || !d.authenticated()) return;
    const owner = d.owner(),
      task = ++maintenance;
    wake?.();
    const live = () => d.current(owner) && maintenance === task && d.authenticated();
    maintaining = task;
    try {
      for (let attempt = 0; attempt <= maintenanceRetryDelays.length; attempt++) {
        if (attempt) await pause(maintenanceRetryDelays[attempt - 1]);
        if (!live() || !d.online()) return;
        if (d.state().status === 'pending') {
          maintenanceWanted = true;
          return;
        }
        try {
          // Its own read, so a Settings read at the same time can't cancel it (#844).
          const installation = await d.native.installation();
          if (!live()) return;
          const confirmed = result(
            await d.request('/api/notifications/device?installationId=' + installation.id, owner, {
              installationKey: installation.key,
            }),
          );
          if (!live()) return;
          const permission = await d.native.permission();
          if (!live()) return;
          const allowed = permission === 'granted';
          if (d.state().status !== 'pending') {
            // As a Settings read: through loading, the one way the flow table leaves off.
            if (d.state().status !== 'loading') set('loading');
            d.publish({
              confirmed,
              status: confirmed.enabled && !allowed ? 'blocked' : 'ready',
              message:
                confirmed.enabled && !allowed
                  ? 'Android blocks notifications. Open Android settings to allow them.'
                  : '',
            });
          }
          // Off, or Android blocking: nothing to maintain, and never a permission prompt.
          if (!confirmed.enabled || !allowed) return;
          const token = given ?? (await d.native.token());
          if (!live()) return;
          const flight = d.request('/api/notifications/device', owner, {
            method: 'POST',
            body: {
              installationId: installation.id,
              installationKey: installation.key,
              revision: confirmed.revision,
              enabled: true,
              token,
              maintenance: true,
            },
          });
          maintenanceFlight = flight;
          const value = await flight;
          // The server's answer stands for this session even if a member's change came since:
          // that change waits for it and sends the revision it confirms.
          if (!d.current(owner) || !d.authenticated()) return;
          d.publish({ ...d.state(), confirmed: result(value) });
          return;
        } catch (error) {
          if (!live() || error instanceof Superseded) return;
          if (
            error instanceof RequestError &&
            (error.networkFailure || error.kind === 'server-error')
          )
            continue;
          // Refused: the controls changed or this binding has no consent. Show what is confirmed.
          if (error instanceof RequestError && error.status === 409) await read();
          return;
        }
      }
    } finally {
      if (maintaining === task) maintaining = null;
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
    maintain,
    reset: () => {
      operation++;
      stopMaintenance();
      maintenanceWanted = false;
      retry = null;
      void clearNative().catch(() => undefined);
    },
  };
}
