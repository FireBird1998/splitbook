import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type { MobileGroup } from '../data/types';
import { ThemeContext, fonts } from './theme';
import { TripStrip } from './trip-strip';

// #117: the Trip Theme's slim boarding-pass strip, rendered.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date('2026-09-01T10:42:00.000Z');
// Trip dates are calendar days at midnight UTC.
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const trip = (overrides: Partial<MobileGroup> = {}): MobileGroup => ({
  id: 'b00000000000000000000001',
  name: 'Goa Friends Trip',
  description: '',
  category: 'trip',
  defaultCurrency: 'INR',
  members: ['Alex Rivera', 'Sam Chen', 'Priya Shah'].map((name, index) => ({
    user: {
      id: `a0000000000000000000000${index + 1}`,
      name,
      email: `${index}@x.test`,
      image: null,
    },
    role: 'member' as const,
    joinedAt: at,
  })),
  startDate: day('2026-09-17'),
  endDate: day('2026-09-20'),
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});
function render(group: MobileGroup, mode: 'light' | 'dark' = 'light') {
  act(() => {
    screen = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <TripStrip group={group} />
      </ThemeContext.Provider>,
    );
  });
  return screen!.root;
}
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
type Style = Record<string, unknown>;
const flat = (style: unknown): Style =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Style) ?? {});
const texts = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .map((node) => ({ shown: node.children.join(''), style: flat(node.props.style) }));
const shown = (root: ReactTestInstance, value: string) => {
  const matches = texts(root).filter((node) => node.shown === value);
  expect(matches).toHaveLength(1);
  return matches[0].style;
};
/** The two route dashes and the perforation. */
const dashes = (root: ReactTestInstance) =>
  root.findAll((node) => isHost(node, 'View') && flat(node.props.style).borderStyle === 'dashed');
const image = (root: ReactTestInstance) => {
  const images = root.findAll(
    (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'image',
  );
  expect(images).toHaveLength(1);
  return images[0];
};

describe('Trip strip', () => {
  it('is one slim image announcing the route, dates and member count', () => {
    const root = render(trip());
    const strip = image(root);
    expect(strip.props.accessible).toBe(true);
    expect(strip.props.accessibilityLabel).toBe(
      'Trip from GOA to TRI, 17 to 20 September, 3 members',
    );
    expect(flat(strip.props.style).borderRadius).toBe(16);
    // About 72 high, growing with large text rather than clipping it.
    const box = flat(root.find((node) => isHost(node, 'LinearGradient')).props.style);
    expect(box.minHeight).toBe(72);
    expect(box.height).toBeUndefined();
    expect(texts(root).map((node) => node.shown)).toEqual(['GOA', 'TRI', '17–20 Sep', '3 MEMBERS']);
    for (const code of ['GOA', 'TRI']) expect(shown(root, code).fontFamily).toBe(fonts.mono);
    expect(shown(root, '3 MEMBERS').fontFamily).toBe(fonts.mono);
    expect(shown(root, '17–20 Sep').fontFamily).toBe(fonts.semibold);
    const plane = root.find((node) => isHost(node, 'Ionicons'));
    expect(plane.props.name).toBe('airplane-outline');
    expect(dashes(root)).toHaveLength(3);
  });

  it.each([
    {
      state: 'across two months',
      dates: { startDate: day('2026-09-28'), endDate: day('2026-10-02') },
      shown: '28 Sep – 2 Oct',
      spoken: '28 September to 2 October',
    },
    {
      state: 'on one day',
      dates: { startDate: day('2026-09-17'), endDate: day('2026-09-17') },
      shown: '17 Sep',
      spoken: '17 September',
    },
    {
      state: 'from a start date only',
      dates: { startDate: day('2026-09-17'), endDate: null },
      shown: 'Starts 17 Sep',
      spoken: 'starts 17 September',
    },
  ])('shows and reads the dates $state', ({ dates, shown: date, spoken }) => {
    const root = render(trip(dates));
    expect(image(root).props.accessibilityLabel).toBe(`Trip from GOA to TRI, ${spoken}, 3 members`);
    shown(root, date);
  });

  it('leaves the dates out until the Trip has a start date', () => {
    const root = render(trip({ startDate: null, endDate: day('2026-09-20') }));
    expect(image(root).props.accessibilityLabel).toBe('Trip from GOA to TRI, 3 members');
    expect(texts(root).map((node) => node.shown)).toEqual(['GOA', 'TRI', '3 MEMBERS']);
  });

  it('counts a lone member in the singular', () => {
    const group = trip();
    const root = render({ ...group, members: group.members.slice(0, 1) });
    expect(image(root).props.accessibilityLabel).toBe(
      'Trip from GOA to TRI, 17 to 20 September, 1 member',
    );
    shown(root, '1 MEMBER');
  });

  it.each(['light', 'dark'] as const)('uses the strip tokens in %s', (mode) => {
    const { strip } = getSemanticTokens(mode);
    const root = render(trip(), mode);
    expect(root.find((node) => isHost(node, 'LinearGradient')).props.colors).toEqual(
      strip.gradient,
    );
    // Muted text falls below 4.5:1 towards the light end of the gradient.
    for (const value of ['GOA', 'TRI', '17–20 Sep', '3 MEMBERS'])
      expect(shown(root, value).color).toBe(strip.text);
    expect(root.find((node) => isHost(node, 'Ionicons')).props.color).toBe(strip.text);
    expect(dashes(root).map((line) => flat(line.props.style).borderColor)).toEqual(
      Array(3).fill(strip.muted),
    );
  });
});
