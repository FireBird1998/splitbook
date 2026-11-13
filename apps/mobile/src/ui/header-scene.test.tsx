import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { HeaderSceneCard } from './header-scene';
import type { MobileGroup } from '../data/types';
vi.mock('react-native-svg', () =>
  Object.fromEntries(
    [
      'default',
      'G',
      'Path',
      'Polygon',
      'Circle',
      'Ellipse',
      'Rect',
      'Defs',
      'RadialGradient',
      'Stop',
    ].map((name) => [name, name]),
  ),
);
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const group = {
  name: 'Goa Friends Trip',
  category: 'trip',
  defaultCurrency: 'INR',
  alternateCurrencies: ['EUR'],
  members: [{}, {}, {}],
  startDate: new Date('2026-09-17'),
  endDate: new Date('2026-09-20'),
} as MobileGroup;
it.each(['trip', 'home'] as const)(
  'reads the %s card facts with display-only Trip days',
  (category) => {
    let rendered!: ReturnType<typeof create>;
    act(() => {
      rendered = create(<HeaderSceneCard group={{ ...group, category }} today="2026-09-18" />);
    });
    const markup = JSON.stringify(rendered.toJSON());
    expect(markup).toContain('INR · EUR');
    expect(markup).toContain('Members');
    if (category === 'trip') {
      expect(markup).toContain('GOA');
      expect(markup).toContain('Trip day 2, today');
    } else {
      expect(markup).toContain('Household');
      expect(markup).not.toContain('Trip day');
      expect(markup).not.toContain('Dates');
    }
    expect(markup).not.toContain('onPress');
    act(() => rendered.unmount());
  },
);

it('speaks the generated scene description', async () => {
  const { default: HeaderScene } = await import('./header-scene');
  const { default: beach } = await import('@splitbook/shared/header-scenes/beach');
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <HeaderScene
        group={group}
        header={{ style: 'scene', scene: 'beach', time: 'day' }}
        motion={false}
        today="2026-09-18"
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(JSON.stringify(renderer.toJSON())).toContain(beach.description);
  act(() => renderer.unmount());
});
