import { describe, expect, it } from 'vitest';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { testPhone } from '../test-utils/test-phone';

const now = Date.UTC(2026, 10, 12, 12);

describe.each(['widget', 'runtime'] as const)(
  'cold widget tap with %s-started restore',
  (start) => {
    describe.each(['expired session', 'Home read 401'] as const)('%s', (failure) => {
      it.each(['setup', 'group'] as const)(
        'opens only account-free setup after restore fails, for a %s target',
        async (kind) => {
          const server = fakeSplitbook();
          const setups: number[] = [];
          const phone = testPhone(server, {
            now,
            parts: {
              widgets: {
                write: async () => {},
                clear: async () => {},
                setSession: async () => {},
                redraw: async () => {},
                openSetup: async (id) => {
                  setups.push(id);
                },
              },
            },
          });
          await phone.open().signIn('alex');
          expect(phone.stores.credentials.value).not.toBeNull();
          const groupId = server.world.groups[0]._id;
          if (failure === 'expired session')
            server.auth.expiresAt = new Date(now - 1_000).toISOString();
          else
            server.reply('GET', '/api/groups', () =>
              Response.json({ code: 'UNAUTHORIZED', error: 'Session expired' }, { status: 401 }),
            );
          const held = server.hold(
            'GET',
            failure === 'expired session' ? '/api/auth/get-session' : '/api/groups',
          );
          const cold = phone.open();
          const restoring = start === 'runtime' ? cold.restore() : null;
          const opening = cold.openWidget(
            kind === 'setup' ? { kind: 'setup', widgetId: 7 } : { kind: 'group', groupId },
          );
          try {
            await held.arrived;
            expect(setups).toEqual([]);
            held.release();
            await restoring;
            await opening;
            expect(cold.getSnapshot()).toMatchObject({
              auth: { status: 'signed-out', user: null },
              screen: 'groups',
              detail: { id: null, data: null },
              notificationOpening: { status: 'idle' },
              heldNotification: null,
              heldNotificationNotice: null,
              heldNotificationSource: null,
            });
            expect(cold.getSnapshot().widgetPicker).not.toBe(true);
            expect(cold.getSnapshot().widgetOpen).toBeUndefined();
            expect(setups).toEqual(kind === 'setup' ? [7] : []);
            expect(
              server.requests.some((request) => request.path === `/api/groups/${groupId}`),
            ).toBe(false);
          } finally {
            held.release();
            await restoring;
            await opening;
          }
        },
      );
    });
  },
);
