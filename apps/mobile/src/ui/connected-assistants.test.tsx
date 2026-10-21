import { View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { emptyAssistants, type AssistantsState } from '../data/assistants';
import { findHosts, largeTextWindows, unreadText } from '../test-utils/layout';
import { setWindow } from '../test-utils/native';
import { ConnectedAssistants } from './connected-assistants';
import { SettingsScreen } from './settings-screen';
import { ThemeContext } from './theme';

// #622: Account → Connected assistants, rendered as the controller's state shows it, at 100%,
// 130% and 200% text. Fictional assistants only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const today = new Date();
const helper = {
  id: 'c1',
  name: 'Fictional Helper',
  host: 'helper.example.test',
  access: 'Ledger + To review',
  lastUsedAt: new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    10,
    41,
  ).toISOString(),
  groups: { reached: 1, of: 2 },
};
const reader = {
  id: 'c2',
  name: 'Fictional Reader',
  host: null,
  access: 'Ledger',
  lastUsedAt: null,
  groups: { reached: 2, of: 2 },
};
const listed = (next: Partial<AssistantsState> = {}): AssistantsState => ({
  ...emptyAssistants(),
  available: true,
  status: 'ready',
  assistants: [helper, reader],
  refreshedAt: Date.now(),
  ...next,
});

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

function render(
  state: AssistantsState,
  { offline = false, mode = 'light' }: { offline?: boolean; mode?: 'light' | 'dark' } = {},
) {
  const actions = { onAsk: vi.fn(), onCancel: vi.fn(), onDisconnect: vi.fn() };
  act(() => {
    renderer = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        {/* One root, as the screen's ScrollView gives it, for the layout checks. */}
        <View>
          <ConnectedAssistants state={state} offline={offline} {...actions} />
        </View>
      </ThemeContext.Provider>,
    );
  });
  return actions;
}

const screenText = () =>
  renderer!.root
    .findAll((node: ReactTestInstance) => String(node.type) === 'Text')
    .map((node) => [node.props.children].flat().join(''))
    .join('\n');
/** The bottom sheet showing, if any, by everything it says. */
const sheet = () =>
  renderer!.root
    .findAll(
      (node: ReactTestInstance) =>
        String(node.type) === 'Modal' && node.props.transparent && node.props.visible,
    )
    .map((modal) =>
      modal
        .findAll((node: ReactTestInstance) => String(node.type) === 'Text')
        .map((node) => [node.props.children].flat().join(''))
        .join('\n'),
    )[0];
const pressable = (label: string) =>
  renderer!.root.find(
    (node: ReactTestInstance) =>
      (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label,
  );

describe('Connected assistants (#622)', () => {
  it('lists each assistant with its access and Group count, when it was last used, and its own Disconnect', () => {
    const actions = render(listed());
    const shown = screenText();
    for (const line of [
      'Assistants act as you, only with the access you give them.',
      'Assistants · 2',
      'Fictional Helper',
      'Read only + To review · 1 of 2 Groups',
      'Fictional Reader',
      'Read only · 2 of 2 Groups',
      'Not used yet',
    ])
      expect(shown).toContain(line);
    expect(shown).toMatch(/Last used \d/);
    act(() => pressable('Disconnect Fictional Reader, Not used yet').props.onPress());
    expect(actions.onAsk).toHaveBeenCalledWith('c2');
    expect(pressable('Disconnect Fictional Helper, helper.example.test')).toBeTruthy();
  });

  it('says connecting and changing Groups happen on the web', () => {
    render(listed());
    expect(screenText()).toContain(
      'Connect an assistant, or change the Groups one reaches, on the web: Splitbook web › Settings › Connected assistants.',
    );
  });

  it('says so when no assistant is connected', () => {
    render(listed({ assistants: [] }));
    const shown = screenText();
    expect(shown).toContain('No connected assistants');
    expect(shown).toContain('Assistants you connect appear here.');
    expect(shown).not.toContain('Assistants · ');
  });

  it('asks in a sheet before it disconnects one', () => {
    const actions = render(listed({ confirming: 'c1' }));
    const asked = sheet()!;
    expect(asked).toContain('Disconnect Fictional Helper?');
    expect(asked).toContain('helper.example.test · Read only + To review');
    expect(asked).toContain(
      'The assistant stops at once. Items already prepared stay in your To review. Previously shared information may remain in your assistant.',
    );
    act(() => pressable('Disconnect').props.onPress());
    expect(actions.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet open with the failure, and Cancel keeps the assistant', () => {
    const actions = render(
      listed({
        confirming: 'c1',
        disconnectMessage: 'Couldn’t confirm the disconnection. Try again.',
      }),
    );
    expect(sheet()).toContain('Couldn’t confirm the disconnection. Try again.');
    act(() => pressable('Cancel, keep Fictional Helper connected').props.onPress());
    expect(actions.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the Saved copy read only offline: Disconnect needs a connection', () => {
    render(listed({ saved: true, confirming: 'c1' }), { offline: true });
    expect(screenText()).toMatch(/Saved \d/);
    // Read only: no row's Disconnect can be pressed, and the screen says why.
    for (const label of [
      'Disconnect Fictional Helper, helper.example.test',
      'Disconnect Fictional Reader, Not used yet',
    ])
      expect(pressable(label).props.disabled, label).toBe(true);
    expect(screenText().split('Disconnecting needs a connection.').length).toBeGreaterThan(2);
    expect(pressable('Disconnect').props.disabled).toBe(true);
    expect(sheet()).toContain('Disconnecting needs a connection.');
  });

  it('says plainly when this phone keeps no copy offline', () => {
    render(
      listed({
        assistants: null,
        unsaved: true,
        message: 'Connected assistants aren’t saved on this phone. Connect to see them.',
      }),
      { offline: true },
    );
    expect(screenText()).toContain(
      'Connected assistants aren’t saved on this phone. Connect to see them.',
    );
  });
});

type Json = ReturnType<ReactTestRenderer['toJSON']>;
/**
 * The screen's own content. A sheet draws over it edge to edge and is checked on its own; the
 * test renderer keeps even a hidden one in the tree.
 */
const screenOnly = (node: Json): Json =>
  node && !Array.isArray(node)
    ? {
        ...node,
        children:
          node.children
            ?.filter((child) => typeof child === 'string' || child.type !== 'Modal')
            .map((child) => (typeof child === 'string' ? child : (screenOnly(child) as never))) ??
          null,
      }
    : node;

describe.each(['light', 'dark'] as const)(
  'Connected assistants at large text in %s (#622)',
  (mode) => {
    it.each([{ width: 412, fontScale: 1 }, ...largeTextWindows])(
      'reads in full, the list, the banner and the sheet, $width dp at $fontScale× text',
      (size) => {
        setWindow(size);
        render(listed({ confirming: 'c1' }), { mode });
        // The screen's content lies 16dp in from each edge.
        expect(
          unreadText(screenOnly(renderer!.toJSON()) as never, size.fontScale, size.width - 32),
        ).toEqual([]);
        const [modal] = findHosts(
          renderer!.toJSON() as never,
          (props, type) => type === 'Modal' && props.visible === true,
        );
        expect(unreadText(modal!, size.fontScale, size.width)).toEqual([]);
      },
    );

    it.each([{ width: 412, fontScale: 1 }, ...largeTextWindows])(
      'reads the empty state in full, $width dp at $fontScale× text',
      (size) => {
        setWindow(size);
        render(listed({ assistants: [] }), { mode });
        expect(
          unreadText(screenOnly(renderer!.toJSON()) as never, size.fontScale, size.width - 32),
        ).toEqual([]);
      },
    );
  },
);

// #770, from the Designer's #622 check: a long assistant name ran to three lines before it was
// cut. Below the largest text it ends at two, so the rows stay even; at the largest it reads in
// full, as every row's title does (#639). The screen reader keeps the whole name.
describe.each(['light', 'dark'] as const)('a long assistant name in %s (#770)', (mode) => {
  const companion = {
    ...helper,
    id: 'c3',
    name: 'Household Ledger Companion for Shared Flats',
    host: 'ledger-companion.example.test',
  };
  it.each([
    { fontScale: 1, lines: 2 },
    { fontScale: 1.3, lines: 2 },
    { fontScale: 2, lines: 0 },
  ])('takes $lines lines at most at $fontScale× text, 360dp (0: all it needs)', (size) => {
    setWindow({ width: 360, height: 640, fontScale: size.fontScale });
    render(listed({ assistants: [companion] }), { mode });
    const name = renderer!.root.find(
      (node: ReactTestInstance) =>
        String(node.type) === 'Text' && node.props.children === companion.name,
    );
    expect(name.props.numberOfLines ?? 0).toBe(size.lines);
    expect(pressable(`Disconnect ${companion.name}, ${companion.host}`)).toBeDefined();
  });
});

describe('Settings → Account (#622)', () => {
  const settings = (assistantsAvailable: boolean) => {
    const onOpenAssistants = vi.fn();
    act(() => {
      renderer = create(
        <SettingsScreen
          user={{
            id: 'a00000000000000000000001',
            name: 'Alex Rivera',
            email: 'alex@example.test',
            image: null,
          }}
          appearance="system"
          onAppearanceChange={vi.fn()}
          preferenceStatus="ready"
          preferenceMessage={null}
          onRetryPreference={vi.fn()}
          environment={{
            label: 'Local',
            apiOrigin: 'http://127.0.0.1:4100',
            webOrigin: 'http://127.0.0.1:4100',
          }}
          onOpenWeb={vi.fn()}
          onSignOut={vi.fn()}
          onOpenAssistants={assistantsAvailable ? onOpenAssistants : undefined}
        />,
      );
    });
    return onOpenAssistants;
  };

  it('offers Connected assistants where the server has them switched on', () => {
    const onOpenAssistants = settings(true);
    act(() => pressable('Connected assistants').props.onPress());
    expect(onOpenAssistants).toHaveBeenCalledTimes(1);
  });

  it('doesn’t offer them where they’re switched off', () => {
    settings(false);
    expect(screenText()).not.toContain('Connected assistants');
  });
});
