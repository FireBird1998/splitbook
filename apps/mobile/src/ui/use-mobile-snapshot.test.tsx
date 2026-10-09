import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it } from 'vitest';
import { createMobileController } from '../data/mobile-controller';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let screen: ReactTestRenderer | undefined;
let dispose = () => {};
afterEach(() => {
  act(() => screen?.unmount());
  dispose();
});

async function signedIn() {
  let cookie: string | null = null;
  const user = { id: 'a00000000000000000000001', name: 'Alex', email: 'a@x.test', image: null };
  const controller = createMobileController(
    { apiBaseUrl: 'http://local', authOrigin: 'http://local', developmentPersonaEnabled: true },
    {
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      fetch: async (url) =>
        new Response(
          JSON.stringify(
            url.includes('sign-in')
              ? { user }
              : url.includes('get-session')
                ? { user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } }
                : url.endsWith('/api/groups')
                  ? { status: 200, data: [] }
                  : { status: 200, data: { buckets: [], groups: [] } },
          ),
          { headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/' } },
        ),
    },
  );
  dispose = controller.dispose;
  await controller.signIn('alex');
  return controller;
}

it('keeps an inline selection stable across parent renders and unrelated publishes', async () => {
  const controller = await signedIn();
  let renders = 0;
  const values: unknown[] = [];
  function Name() {
    const value = useMobileSnapshot(controller, (state) => state.auth.user);
    renders++;
    values.push(value);
    return <span>{value?.name}</span>;
  }
  await act(async () => {
    screen = create(<Name />);
  });
  act(() => controller.updateCreation({ name: 'Our home' }));
  expect(renders).toBe(1);
  act(() => screen!.update(<Name />));
  expect(values[1]).toBe(values[0]);
  expect(screen!.toJSON()).toMatchObject({ children: ['Alex'] });
});

it('uses the equality check for a fresh projection and renders the next selected value', async () => {
  const controller = await signedIn();
  let renders = 0;
  function Name() {
    const value = useMobileSnapshot(
      controller,
      (state) => ({ name: state.creation.draft.name }),
      (before, after) => before.name === after.name,
    );
    renders++;
    return <span>{value.name || 'New Group'}</span>;
  }
  await act(async () => {
    screen = create(<Name />);
  });
  act(() => controller.updateCreation({ startDate: '2026-10-10' }));
  expect(renders).toBe(1);
  act(() => controller.updateCreation({ name: 'Our home' }));
  expect(renders).toBe(2);
  expect(screen!.toJSON()).toMatchObject({ children: ['Our home'] });
});

it('renders changed projection keys even when their values are undefined', async () => {
  const controller = await signedIn();
  function Name() {
    const value = useMobileSnapshot(
      controller,
      (state): Record<string, undefined> =>
        state.creation.draft.name ? { named: undefined } : { empty: undefined },
      sameSelection,
    );
    return <span>{Object.keys(value)[0]}</span>;
  }
  await act(async () => {
    screen = create(<Name />);
  });
  act(() => controller.updateCreation({ name: 'Our home' }));
  expect(screen!.toJSON()).toMatchObject({ children: ['named'] });
});
