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
    expect(markup).toContain('INR\u00a0· EUR');
    expect(markup).toContain('Members');
    if (category === 'trip') {
      expect(markup).toContain('GOA');
      expect(markup).toContain('Day 2 of 4');
      expect(markup).toContain('17–20 Sep 2026');
      const stops = rendered.root.findAll(
        (node) =>
          (node.type as unknown) === 'View' &&
          node.props.accessible &&
          node.props.accessibilityLabel === 'Day 2 of 4',
      );
      expect(stops).toHaveLength(1);
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
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(JSON.stringify(renderer.toJSON())).toContain(beach.description);
  });
  act(() => renderer.unmount());
});

it('re-reads Auto when returning to the header across a local-hour boundary', async () => {
  const { default: HeaderScene } = await import('./header-scene');
  const hour = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(
        <HeaderScene
          group={group}
          header={{ style: 'scene', scene: 'beach', time: 'auto' }}
          motion={false}
        />,
      );
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(JSON.stringify(renderer.toJSON())).toContain('#c8d9ed');
    });
    hour.mockReturnValue(10);
    act(() =>
      renderer.update(
        <HeaderScene
          group={group}
          header={{ style: 'scene', scene: 'beach', time: 'auto' }}
          motion={false}
        />,
      ),
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('#a9d3ec');
  } finally {
    act(() => renderer?.unmount());
    hour.mockRestore();
  }
});

it('uses the local hand-built day key when Intl does not produce an ISO day', async () => {
  const { default: HeaderScene } = await import('./header-scene');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 18, 10).getTime());
  const locale = vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('18/09/2026');
  let view!: ReturnType<typeof create>;
  try {
    await act(async () => {
      view = create(
        <HeaderScene group={group} header={{ style: 'scene', scene: 'beach', time: 'day' }} />,
      );
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(
        view.root.findAll(
          (node) => (node.type as unknown) === 'View' && node.props.accessibilityRole === 'image',
        ),
      ).toHaveLength(1);
    });
    expect(JSON.stringify(view.toJSON())).toContain('Day 2 of 4');
    expect(locale).not.toHaveBeenCalled();
  } finally {
    act(() => view?.unmount());
    clock.mockRestore();
    locale.mockRestore();
  }
});
