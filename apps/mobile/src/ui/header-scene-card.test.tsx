import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { headerCard } from '@splitbook/shared/group-header';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { HeaderSceneCard, HeaderScenePlaceholder } from './header-scene-card';
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
} as MobileGroup;

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
          (node) => (node.type as unknown) === 'View' && flatten(node.props.style).borderColor,
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
  const clock = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(hour);
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
    clock.mockRestore();
  }
});
