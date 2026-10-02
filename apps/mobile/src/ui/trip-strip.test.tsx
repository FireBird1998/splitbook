import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type { MobileGroup } from '../data/types';
import { ThemeContext, fonts } from './theme';
import { TripStrip } from './trip-strip';

// #117: the Trip Theme's slim boarding-pass strip, rendered.
const device = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: device.fontScale }),
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
  device.fontScale = 1;
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
    .map((node) => ({ node, shown: node.children.join(''), style: flat(node.props.style) }));
const shown = (root: ReactTestInstance, value: string) => {
  const matches = texts(root).filter((node) => node.shown === value);
  expect(matches).toHaveLength(1);
  return matches[0].style;
};
/** The style of the View holding this text. */
const holder = (root: ReactTestInstance, value: string) => {
  let node = texts(root).find((text) => text.shown === value)!.node.parent;
  while (node && typeof node.type !== 'string') node = node.parent;
  return flat(node!.props.style);
};
const gradient = (root: ReactTestInstance) =>
  flat(root.find((node) => isHost(node, 'LinearGradient')).props.style);
/** The two route dashes, then the perforation. */
const rules = (root: ReactTestInstance) =>
  root.findAll((node) => isHost(node, 'View') && typeof node.props.onLayout === 'function');
const segments = (rule: ReactTestInstance) =>
  rule.children.filter((child): child is ReactTestInstance => typeof child !== 'string');
/** Native layout gives every rule 67 across and 48 down. */
const lay = (root: ReactTestInstance) =>
  act(() => {
    for (const rule of rules(root))
      rule.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 67, height: 48 } } });
  });
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
    expect(texts(root).map((node) => node.shown)).toEqual(['GOA', 'TRI', '17–20 Sep', '3 MEMBERS']);
    for (const code of ['GOA', 'TRI']) expect(shown(root, code).fontFamily).toBe(fonts.mono);
    expect(shown(root, '3 MEMBERS').fontFamily).toBe(fonts.mono);
    expect(shown(root, '17–20 Sep').fontFamily).toBe(fonts.semibold);
    const plane = root.find((node) => isHost(node, 'Ionicons'));
    expect(plane.props.name).toBe('airplane-outline');
  });

  it('sizes itself from its text, with the dates beside the route', () => {
    const root = render(trip());
    // About 72 high and growing with the text: nothing stretches the strip.
    const box = gradient(root);
    expect(box).toMatchObject({ minHeight: 72, flexDirection: 'row' });
    for (const key of ['height', 'flex', 'flexGrow', 'position'])
      expect(box).not.toHaveProperty(key);
    // The route takes only the width the stub leaves; the stub keeps its natural width.
    expect(holder(root, 'GOA').flex).toBe(1);
    const stub = holder(root, '17–20 Sep');
    expect(holder(root, '3 MEMBERS')).toEqual(stub);
    for (const key of ['width', 'flex', 'flexGrow', 'flexShrink', 'flexBasis'])
      expect(stub).not.toHaveProperty(key);
    const perforation = flat(rules(root)[2].props.style);
    expect(perforation).toMatchObject({ width: 1, alignSelf: 'stretch' });
    expect(perforation).not.toHaveProperty('flex');
  });

  it('draws its dashes as short segments, which Android can’t render solid', () => {
    const root = render(trip());
    expect(
      root.findAll((node) => isHost(node, 'View') && 'borderStyle' in flat(node.props.style)),
    ).toHaveLength(0);
    expect(rules(root).map((rule) => segments(rule).length)).toEqual([0, 0, 0]);
    lay(root);
    // As many 4-long dashes, 3 apart, as fit: 10 across 67 and 7 down 48.
    expect(rules(root).map((rule) => segments(rule).length)).toEqual([10, 10, 7]);
    const [route, , perforation] = rules(root);
    expect(flat(segments(route)[0].props.style)).toMatchObject({ width: 4, height: 1 });
    expect(flat(segments(perforation)[0].props.style)).toMatchObject({ width: 1, height: 4 });
  });

  it('moves the dates below the route at large text', () => {
    device.fontScale = 1.3;
    const root = render(trip());
    expect(image(root).props.accessibilityLabel).toBe(
      'Trip from GOA to TRI, 17 to 20 September, 3 members',
    );
    const box = gradient(root);
    expect(box.minHeight).toBe(72);
    expect(box).not.toHaveProperty('flexDirection');
    expect(holder(root, 'GOA')).not.toHaveProperty('flex');
    expect(holder(root, '17–20 Sep')).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    // The perforation runs across, under the route.
    expect(flat(rules(root)[2].props.style)).toMatchObject({ height: 1, flexDirection: 'row' });
    expect(texts(root).map((node) => node.shown)).toEqual(['GOA', 'TRI', '17–20 Sep', '3 MEMBERS']);
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
    lay(root);
    const dashes = rules(root).flatMap(segments);
    expect(dashes).toHaveLength(27);
    for (const dash of dashes) expect(flat(dash.props.style).backgroundColor).toBe(strip.muted);
  });
});
