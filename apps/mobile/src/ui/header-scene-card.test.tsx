import { act, create } from 'react-test-renderer';
import { expect, it, onTestFinished, vi } from 'vitest';
import { hermesZoneMoved } from '@splitbook/shared/test-support/hermes-zone';
import { headerCard } from '@splitbook/shared/group-header';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { HeaderSceneCard, HeaderScenePlaceholder, PREVIEW_HEIGHT } from './header-scene-card';
import { ThemeContext } from './theme';
import { flatten } from '../test-utils/layout';
import type { MobileGroup } from '../data/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const group = {
  name: 'Goa Friends Trip',
  category: 'trip',
  members: [{}, {}],
  defaultCurrency: 'INR',
  alternateCurrencies: [],
  startDate: new Date('2026-11-03'),
  endDate: new Date('2026-11-06'),
} as unknown as MobileGroup;

it.each(['light', 'dark'] as const)('uses the shared scene-card tone in %s appearance', (mode) => {
  for (const category of ['trip', 'home'] as const) {
    for (const time of ['morning', 'day', 'sunset', 'night'] as const) {
      const current = { ...group, category };
      const expected = getSemanticTokens(
        headerCard(current, '2026-11-04', time).tone === 'dark' ? 'dark' : mode,
      );
      for (const loading of [false, true]) {
        let view!: ReturnType<typeof create>;
        act(() => {
          view = create(
            <ThemeContext.Provider value={getSemanticTokens(mode)}>
              {loading ? (
                <HeaderScenePlaceholder
                  group={current}
                  header={{ style: 'scene', scene: 'beach', time }}
                />
              ) : (
                <HeaderSceneCard group={current} today="2026-11-04" time={time} />
              )}
            </ThemeContext.Provider>,
          );
        });
        const surface = view.root.findAll(
          (node) => (node.type as unknown) === 'View' && flatten(node.props.style).padding === 14,
        );
        expect(surface).toHaveLength(1);
        expect(flatten(surface[0].props.style).backgroundColor).toBe(expected.surface);
        const texts = surface[0].findAll((node) => (node.type as unknown) === 'Text');
        expect(texts.length).toBeGreaterThan(0);
        for (const text of texts)
          expect([expected.text, expected.textSecondary]).toContain(
            flatten(text.props.style).color,
          );
        const dividers = surface[0].findAll(
          (node) =>
            (node.type as unknown) === 'View' && Boolean(flatten(node.props.style).borderColor),
        );
        for (const divider of dividers)
          expect(flatten(divider.props.style).borderColor).toBe(expected.border);
        act(() => view.unmount());
      }
    }
  }
});
it.each([
  [12, 'light'],
  [18, 'dark'],
  [23, 'dark'],
] as const)('the loading Auto card follows local hour %s', (hour, mode) => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 16, hour, 30) });
  let view!: ReturnType<typeof create>;
  try {
    act(() => {
      view = create(
        <HeaderScenePlaceholder
          group={{ ...group, header: { style: 'scene', scene: 'beach', time: 'auto' } }}
        />,
      );
    });
    expect(JSON.stringify(view.toJSON())).toContain(getSemanticTokens(mode).surface);
  } finally {
    act(() => view.unmount());
    vi.useRealTimers();
  }
});

// #1298: the app started in India and the phone moved to Pago Pago while it ran. Hermes keeps
// India for its dates (#1283); the loading card's hour and Trip day are the phone's. At 08:00 UTC
// on 21 Nov it is 1:30 PM on 21 Nov in India and 9:00 PM on 20 Nov in Pago Pago.
it('the loading Auto card follows the phone’s hour and day after its zone moves while the app runs (#1298)', () => {
  onTestFinished(hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago'));
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-21T08:00:00.000Z') });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  let view!: ReturnType<typeof create>;
  act(() => {
    view = create(
      <HeaderScenePlaceholder
        group={{
          ...group,
          startDate: new Date('2026-11-19'),
          endDate: new Date('2026-11-22'),
          header: { style: 'scene', scene: 'beach', time: 'auto' },
        }}
      />,
    );
  });
  const markup = JSON.stringify(view.toJSON());
  act(() => view.unmount());
  expect(markup).toContain(getSemanticTokens('dark').surface);
  expect(markup).toContain('Day 2 of 4');
});

// #1267: the settings page draws the preview's caption on its card, in the app's own theme at
// every time of day (the board's white strip); the loading preview is the picture's place alone.
it.each(['light', 'dark'] as const)(
  'the loading settings preview is the picture alone, as tall as the loaded one, in %s',
  (mode) => {
    for (const time of ['morning', 'day', 'sunset', 'night'] as const) {
      let view!: ReturnType<typeof create>;
      act(() => {
        view = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <HeaderScenePlaceholder
              group={group}
              preview={{ style: 'scene', scene: 'sakura', time }}
            />
          </ThemeContext.Provider>,
        );
      });
      const tree = view.toJSON() as unknown as {
        props: { style: unknown; accessibilityLabel: string };
      };
      expect(tree.props.accessibilityLabel).toBe('Loading Header scene');
      expect(flatten(tree.props.style)).toMatchObject({
        height: PREVIEW_HEIGHT,
        backgroundColor: getSemanticTokens(mode).surfaceMuted,
      });
      expect(view.root.findAll((node) => (node.type as unknown) === 'Text')).toHaveLength(0);
      act(() => view.unmount());
    }
  },
);
