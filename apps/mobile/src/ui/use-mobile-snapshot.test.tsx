import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it } from 'vitest';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let screen: ReactTestRenderer | undefined;
let dispose = () => {};
afterEach(() => {
  act(() => screen?.unmount());
  dispose();
});

async function signedIn() {
  const server = fakeSplitbook();
  server.world.people.alex = {
    id: 'a00000000000000000000001',
    name: 'Alex',
    email: 'a@x.test',
    image: null,
  };
  server.world.groups = [];
  server.world.home = { buckets: [], groups: [] };
  server.auth.cookie = () => 'better-auth.session_token=test.signature';
  const phone = testPhone(server, {
    origin: 'http://local',
    parts: {
      accountLocal: undefined,
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
    },
  });
  const controller = phone.open();
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
