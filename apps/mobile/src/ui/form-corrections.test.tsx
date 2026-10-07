import { useSyncExternalStore, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { visibleFieldErrors } from '../data/field-feedback';
import { groupFields } from '../data/group-draft';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { FetchResponse, MobileFetch } from '../data/types';
import { GroupCreateForm } from './group-workflows';
import { RecordPaymentSheet, recordPaymentFootnote } from './record-payment-sheet';

// #105: rendered Group creation and Settlement corrections through the real controller.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test', image: null };
const alexId = 'a00000000000000000000001';
const groupId = 'b00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: alexId,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [
    {
      user: { _id: alexId, name: 'Alex', email: 'alex@example.test' },
      role: 'admin',
      joinedAt: iso,
    },
    { user: { _id: sam.id, name: 'Sam', email: sam.email }, role: 'member', joinedAt: iso },
  ],
  createdAt: iso,
  updatedAt: iso,
};
const json = (data: unknown, status = 200): FetchResponse => Response.json(data, { status });

function backend() {
  const writes: string[] = [];
  let holdWrites: Promise<void> | null = null;
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (method !== 'GET' && path.startsWith('/api/groups')) {
      writes.push(`${method} ${path}`);
      await holdWrites;
    }
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user: sam }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=sam.signature; Max-Age=2592000' },
      });
    if (path.endsWith('/get-session'))
      return json({ user: sam, session: { userId: sam.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === '/api/groups' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      return json(
        {
          status: 201,
          data: {
            ...group,
            _id: 'b00000000000000000000009',
            name: body.name,
            members: [
              {
                user: { _id: sam.id, name: 'Sam', email: sam.email },
                role: 'admin',
                joinedAt: iso,
              },
            ],
          },
        },
        201,
      );
    }
    if (path === '/api/groups') return json({ status: 200, data: [group] });
    if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
    if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
    if (path.endsWith('/balances'))
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [
                { user: { _id: sam.id, name: 'Sam' }, balance: -30 },
                { user: { _id: alexId, name: 'Alex' }, balance: 30 },
              ],
              debts: [
                {
                  from: { _id: sam.id, name: 'Sam' },
                  to: { _id: alexId, name: 'Alex' },
                  amount: 30,
                },
              ],
            },
          ],
        },
      });
    if (path.endsWith('/settlements') && method === 'POST') {
      const body = JSON.parse(String(init.body));
      return json(
        {
          status: 201,
          data: {
            _id: 'c00000000000000000000001',
            group: groupId,
            paidBy: { _id: sam.id, name: 'Sam' },
            paidTo: { _id: alexId, name: 'Alex' },
            amount: body.amount,
            amountMinor: Math.round(body.amount * 100),
            moneyVersion: 1,
            currency: 'INR',
            note: body.note ?? '',
            createdAt: iso,
          },
        },
        201,
      );
    }
    if (path.endsWith('/settlements')) return json({ status: 200, data: [] });
    return json({}, 404);
  };
  let cookie: string | null = null,
    owner: string | null = null;
  const attempts = new Map<string, unknown>();
  const store = {
    load: async (account: string, id: string) =>
      structuredClone(attempts.get(account + id) ?? null),
    save: async (account: string, id: string, value: unknown) => {
      attempts.set(account + id, structuredClone(value));
    },
    remove: async (account: string, id: string) => {
      attempts.delete(account + id);
    },
    clear: async () => attempts.clear(),
  };
  const creations = new Map<string, unknown>();
  const groupCreations = {
    load: async (account: string) => structuredClone(creations.get(account) ?? null),
    save: async (account: string, value: unknown) => {
      creations.set(account, structuredClone(value));
    },
    remove: async (account: string) => {
      creations.delete(account);
    },
    clear: async () => creations.clear(),
  };
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      fetch,
      now: () => Date.parse(iso),
      newSubmissionKey: () => 'payment-attempt-0001',
      settlementAttempts: store,
      groupCreations,
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      accountLocal: {
        owner: {
          load: async () => owner,
          save: async (value) => {
            owner = value;
          },
          clear: async () => {
            owner = null;
          },
        },
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
        stores: [store, groupCreations],
      },
    },
  );
  return {
    controller,
    writes,
    hold(until: Promise<void>) {
      holdWrites = until;
    },
  };
}

interface NodeMock {
  element: ReactElement<Record<string, unknown>>;
  focus: ReturnType<typeof vi.fn>;
}

function CreateScreen({
  controller,
  onReveal,
}: {
  controller: MobileController;
  onReveal: (section: unknown) => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <GroupCreateForm
      draft={state.creation.draft}
      onChange={controller.updateCreation}
      onSubmit={() => void controller.createGroup()}
      busy={state.creation.status === 'saving'}
      uncertain={state.creation.status === 'uncertain'}
      message={state.creation.message}
      errors={visibleFieldErrors(groupFields, state.creation.validation)}
      focus={state.creation.validation.focus}
      onLeaveField={controller.touchCreationField}
      onReveal={onReveal}
      onShowStatus={showStatus}
      onCheckGroups={() => undefined}
      onDiscard={() => undefined}
    />
  );
}
/** Create Group asks for its "Sending this Group…" note to be scrolled into view. */
const showStatus = vi.fn();

function PaymentSheet({ controller }: { controller: MobileController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <RecordPaymentSheet
      visible={state.screen === 'settlement'}
      state={state.settlement}
      currentUserId={sam.id}
      today="Today, Sep 28"
      onChange={controller.updateSettlement}
      onLeaveField={controller.touchSettlementField}
      onAcknowledge={controller.acknowledgeSettlement}
      onRecord={() => void controller.recordSettlement()}
      onClose={() => void controller.back()}
    />
  );
}

const settle = () =>
  act(async () => {
    for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
/** The Field wrapper that owns an input: its label, input, hint and correction. */
const fieldOf = (input: ReactTestInstance) => input.parent!;
const corrections = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'View') && node.props.accessible === true)
    .map((node) => node.props.accessibilityLabel as string);
const text = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});

async function render(which: 'create' | 'payments') {
  const harness = backend();
  await harness.controller.signIn('sam');
  if (which === 'create') harness.controller.startCreate();
  else {
    await harness.controller.openSettlements(groupId);
    harness.controller.selectSettlement(sam.id, alexId, 'INR');
  }
  const revealed: NodeMock[] = [];
  const mocks: NodeMock[] = [];
  const Screen = which === 'create' ? CreateScreen : PaymentSheet;
  await act(async () => {
    screen = create(
      <Screen
        controller={harness.controller}
        onReveal={(section) => revealed.push(section as NodeMock)}
      />,
      {
        createNodeMock: (element) => {
          const mock = { element, focus: vi.fn() } as NodeMock;
          mocks.push(mock);
          return mock;
        },
      },
    );
  });
  const root = () => screen!.root;
  const input = (label: string) =>
    root().find((node) => isHost(node, 'TextInput') && node.props.accessibilityLabel === label);
  const pressable = (label: string) =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') && String(node.props.accessibilityLabel ?? '').startsWith(label),
    );
  const run = async (action: () => void) => {
    await act(async () => action());
    await settle();
  };
  // Callback refs re-attach on render, so one input can own several node mocks.
  const focusCount = (label: string) =>
    mocks
      .filter((mock) => mock.element.props.accessibilityLabel === label)
      .reduce((count, mock) => count + mock.focus.mock.calls.length, 0);
  return {
    ...harness,
    root,
    input,
    pressable,
    revealed,
    focusCount,
    type: (label: string, value: string) => run(() => input(label).props.onChangeText(value)),
    leave: (label: string) => run(() => input(label).props.onBlur()),
    press: (label: string) => run(() => pressable(label).props.onPress()),
  };
}

describe('Group creation corrections, rendered', () => {
  it('marks the name required, explains a blank name at the field and focuses it, then creates', async () => {
    const view = await render('create');
    const name = () => view.input('Trip name, required');
    expect(text(fieldOf(name()))).toContain('Trip name · Required');
    expect(view.pressable('Create trip').props.disabled).toBe(false);

    await view.press('Create trip');
    expect(view.writes).toEqual([]);
    expect(corrections(fieldOf(name()))).toEqual([
      'Add a name for this trip, such as Goa Weekend.',
    ]);
    expect(name().props.accessibilityHint).toContain('Add a name for this trip');
    expect(view.focusCount('Trip name, required')).toBe(1);
    expect(view.revealed).toHaveLength(1);

    await view.type('Trip name, required', 'Goa weekend');
    expect(corrections(fieldOf(name()))).toEqual([]);
    await view.press('Create trip');
    expect(view.writes).toEqual(['POST /api/groups']);
  });

  it('attaches an impossible Trip date to its field after it is left', async () => {
    const view = await render('create');
    await view.type('Start date', '2026-02-30');
    expect(corrections(fieldOf(view.input('Start date')))).toEqual([]);
    await view.leave('Start date');
    expect(corrections(fieldOf(view.input('Start date')))).toEqual([
      '2026-02-30 isn’t a real date. Check the day and month.',
    ]);
  });

  it('explains why Create is unavailable while the Group is being sent', async () => {
    showStatus.mockClear();
    const view = await render('create');
    let release!: () => void;
    view.hold(new Promise<void>((resolve) => (release = resolve)));
    await view.type('Trip name, required', 'Goa weekend');
    await view.press('Create trip');
    const button = view.pressable('Creating your Group…');
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityHint).toBe(
      'Sending this Group. Keep this screen open until SplitBook confirms it.',
    );
    expect(text(view.root())).toContain('Keep this screen open until SplitBook confirms it.');
    // #331: at the end of a long form the note can open below the screen: it asks, once, to be
    // shown whole.
    expect(showStatus).toHaveBeenCalledOnce();
    const [note] = showStatus.mock.calls[0] as [NodeMock];
    const shown = note.element.props.children as { props: { children: string } };
    expect(shown.props.children).toBe(
      'Sending this Group. Keep this screen open until SplitBook confirms it.',
    );
    await act(async () => release());
    await settle();
    expect(view.writes).toEqual(['POST /api/groups']);
  });
});

describe('Record payment corrections, rendered', () => {
  it('attaches the Amount correction to its field, keeps every entry, and records once the overpayment is ticked', async () => {
    const view = await render('payments');
    const amount = () => view.input('Amount paid, required');
    // The Amount card: its label, the currency and input, and the correction.
    const amountCorrections = () =>
      corrections(amount().parent!.parent!).filter((label) => !label.startsWith('Currency'));
    expect(amount().props.value).toBe('30');
    const shown = text(view.root());
    expect(shown).toContain('Suggested ₹30.00');
    expect(shown).toContain(recordPaymentFootnote);
    await view.press('Note, optional: Add a note');
    await view.type('Note', 'Paid in cash');
    await view.type('Amount paid, required', '12.345');
    await view.press('Record payment');

    expect(view.writes).toEqual([]);
    const correction = 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.';
    expect(amountCorrections()).toEqual([correction]);
    expect(amount().props.accessibilityHint).toContain(correction);
    expect(view.focusCount('Amount paid, required')).toBe(1);
    // One correction shows once, on its field, not again as a banner.
    expect(text(view.root()).split(correction)).toHaveLength(2);
    expect(amount().props.value).toBe('12.345');
    expect(view.input('Note').props.value).toBe('Paid in cash');

    await view.type('Amount paid, required', '40');
    expect(amountCorrections()).toEqual([]);
    expect(text(view.root())).toContain(
      'That’s ₹10.00 more than suggested. Afterwards you’d be owed ₹10.00 in this Group.',
    );
    // Above the suggestion, Record says why it waits for the tick.
    const record = view.pressable('Record payment');
    expect(record.props.accessibilityLabel).toBe('Record payment ₹40.00');
    expect(record.props.disabled).toBe(true);
    expect(record.props.accessibilityHint).toBe('Tick “I meant to pay more than suggested” first.');
    await view.press('I meant to pay more than suggested');
    expect(view.pressable('I meant to pay more than suggested').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(view.pressable('Record payment').props.disabled).toBe(false);
    await view.press('Record payment');
    expect(view.writes).toEqual([`POST /api/groups/${groupId}/settlements`]);
  });
});
