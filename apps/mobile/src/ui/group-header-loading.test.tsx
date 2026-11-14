import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupHeader } from './group-header';
import type { MobileGroup } from '../data/types';
vi.mock('./header-scene', () => new Promise(() => {}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllEnvs());
it.each(['trip', 'home'])(
  'reserves the scene and card while the %s renderer module is pending',
  async (category) => {
    vi.stubEnv('EXPO_PUBLIC_HEADER_SCENES_ENABLED', 'true');
    const group = {
      name: 'Goa Friends Trip',
      category,
      header: { style: 'scene', scene: 'beach', time: 'day' },
      members: [],
      defaultCurrency: 'INR',
      alternateCurrencies: [],
      startDate: new Date('2026-11-03'),
      endDate: new Date('2026-11-06'),
    } as unknown as MobileGroup;
    let view!: ReturnType<typeof create>;
    await act(async () => {
      view = create(<GroupHeader group={group} />);
    });
    const placeholder = view.root.findAll(
      (node) =>
        (node.type as unknown) === 'View' &&
        node.props.accessibilityLabel === 'Loading Header scene',
    );
    expect(placeholder).toHaveLength(1);
    expect(placeholder[0].props.style.height).toBe(208);
    expect(JSON.stringify(view.toJSON())).toContain('Members');
    act(() => view.unmount());
  },
);
