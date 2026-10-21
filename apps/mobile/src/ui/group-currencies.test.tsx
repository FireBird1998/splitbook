import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type { GroupCurrencySettings } from '@splitbook/shared/group-currency-settings';
import type { GroupCurrenciesState } from '../data/types';
import { largeTextWindows, unreadText } from '../test-utils/layout';
import { setWindow } from '../test-utils/native';
import { GroupCurrencies } from './group-currencies';
import { refreshedLabel } from './refresh-feedback';
import { ThemeContext } from './theme';

// #722, boards "Group currencies (removing points to the web)" and "Add a currency": a Group's
// currencies, from its options, rendered. Fictional Group and people.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const groupId = 'b00000000000000000000001';
const you = 'a00000000000000000000001',
  sam = 'a00000000000000000000002';
const at = new Date('2026-10-12T10:42:00').getTime();
/** Lisbon & Tokyo: euros used by 11 Expenses and a Settlement, yen by 24 Expenses. */
const lisbon: GroupCurrencySettings = {
  mainCurrency: { code: 'INR', locked: true },
  extraCurrencies: [
    {
      code: 'EUR',
      use: {
        expenses: { count: 11, items: [] },
        settlements: 1,
        toReview: { yours: 0, others: 0 },
      },
      added: { by: { _id: sam, name: 'Sam' }, at: '2026-10-01T09:00:00.000Z' },
    },
    {
      code: 'JPY',
      use: {
        expenses: { count: 24, items: [] },
        settlements: 0,
        toReview: { yours: 0, others: 0 },
      },
      added: { by: { _id: sam, name: 'Sam' }, at: '2026-10-05T09:00:00.000Z' },
    },
  ],
};
const ready = (overrides: Partial<GroupCurrenciesState> = {}): GroupCurrenciesState => ({
  groupId,
  status: 'ready',
  data: lisbon,
  message: null,
  refreshedAt: at,
  restored: false,
  ...overrides,
});

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const pressable = (root: ReactTestInstance, label: string) =>
  root.find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === label);
function view(
  props: Partial<Parameters<typeof GroupCurrencies>[0]> = {},
  mode: 'light' | 'dark' = 'light',
) {
  const calls = { onAdd: vi.fn(), onOpenWeb: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
  act(() => {
    screen = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <GroupCurrencies
          groupName="Lisbon & Tokyo"
          viewerId={you}
          state={ready()}
          offline={false}
          adding={{ groupId, status: 'idle', message: null }}
          now={new Date('2026-10-12T12:00:00')}
          {...calls}
          {...props}
        />
      </ThemeContext.Provider>,
    );
  });
  return { root: screen!.root, ...calls };
}

describe('a Group’s currencies (#722)', () => {
  it('lists the main currency and its lock, then each extra currency with what uses it', () => {
    const { root } = view();
    const shown = text(root);
    expect(shown).toContain(
      'Expenses and payments in Lisbon & Tokyo can use any of these. Nothing is converted.',
    );
    expect(shown).toContain('Main currency');
    expect(shown).toContain('INRIndian RupeeLocked: money is already recorded in INR');
    expect(shown).toContain('Extra currencies');
    expect(shown).toContain('2 of 4');
    expect(shown).toContain('EUREuro11 Expenses · 1 Settlement · added by Sam, 1 Oct');
    expect(shown).toContain(
      'JPYJapanese Yen24 Expenses · whole amounts only · added by Sam, 5 Oct',
    );
    expect(shown).toContain('Anyone in the Group can add one. Activity shows who added it.');
    expect(shown).toContain('Removing a currency is on the web for now.');
    expect(shown).toContain('An admin can remove one that nothing uses.');
    expect(shown).toContain(`Updated ${refreshedLabel(at)}`);
  });

  it('sends removing a currency to the web', () => {
    const { root, onOpenWeb } = view();
    act(() => pressable(root, 'Open on the web').props.onPress());
    expect(onOpenWeb).toHaveBeenCalledTimes(1);
  });

  it('adds one from a search, as the Expense form does', () => {
    const { root, onAdd } = view();
    act(() => pressable(root, 'Add a currency').props.onPress());
    const sheet = root
      .findAll((node) => isHost(node, 'Modal') && node.props.visible === true)
      .find((modal) => text(modal).includes('Add a currency'))!;
    expect(text(sheet)).toContain('Lisbon & Tokyo · 2 of 4 extra currencies');
    act(() => pressable(sheet, 'CHF, Swiss Franc').props.onPress());
    act(() => pressable(sheet, 'Add CHF').props.onPress());
    expect(onAdd).toHaveBeenCalledWith('CHF');
  });

  it('offline, shows this phone’s copy with its time, and adding needs a connection', () => {
    const { root } = view({ state: ready({ restored: true }), offline: true });
    expect(text(root)).toContain(`Saved ${refreshedLabel(at)}`);
    const add = pressable(root, 'Add a currency');
    expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    expect(add.props.accessibilityHint).toBe('Adding a currency needs a connection.');
  });

  it('says when this phone keeps no copy of them, and retries', () => {
    const { root, onRetry } = view({
      state: ready({
        status: 'error',
        data: null,
        refreshedAt: null,
        message: 'These currencies aren’t saved on this phone. Connect to load them.',
      }),
      offline: true,
    });
    expect(text(root)).toContain(
      'These currencies aren’t saved on this phone. Connect to load them.',
    );
    act(() => pressable(root, 'Try again').props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(largeTextWindows)('reads in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    view();
    const tree = screen!.toJSON() as ReactTestRendererJSON;
    expect(unreadText(tree, size.fontScale, size.width - 32)).toEqual([]);
  });
});
