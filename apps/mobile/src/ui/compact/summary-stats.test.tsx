import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { setWindow } from '../../test-utils/native';
import { ThemeContext } from '../theme';
import { SummaryStats, type SummaryStat } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const figures: SummaryStat[] = [
  { label: 'Spent', value: '₹201,670.00' },
  { label: 'Your share', value: '₹69,726.68' },
  { label: 'You paid', value: '₹191,670.00' },
];
let screen: ReactTestRenderer | undefined;
afterEach(() => act(() => screen?.unmount()));

const element = (stats: SummaryStat[], mode: 'light' | 'dark' = 'light') => (
  <ThemeContext.Provider value={getSemanticTokens(mode)}>
    <SummaryStats stats={stats} />
  </ThemeContext.Provider>
);
function render(stats = figures, mode: 'light' | 'dark' = 'light') {
  act(() => {
    screen = create(element(stats, mode));
  });
  return screen!.root;
}
const host = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const amounts = (root: ReactTestInstance) =>
  root.findAll(
    (node) =>
      host(node, 'Text') &&
      node.children.some((value) => typeof value === 'string' && value.startsWith('₹')),
  );
const entries = (root: ReactTestInstance) =>
  root.findAll((node) => host(node, 'View') && node.props.accessible === true);
const container = (root: ReactTestInstance) => entries(root)[0]!.parent!;
const direction = (root: ReactTestInstance) => container(root).props.style.flexDirection;
function resize(root: ReactTestInstance, width: number) {
  expect(container(root).props.onLayout).toBeTypeOf('function');
  act(() => container(root).props.onLayout({ nativeEvent: { layout: { width } } }));
}
function textLayout(node: ReactTestInstance, widths: number[]) {
  expect(node.props.onTextLayout).toBeTypeOf('function');
  act(() =>
    node.props.onTextLayout({ nativeEvent: { lines: widths.map((width) => ({ width })) } }),
  );
}
const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : ((style as Record<string, unknown>) ?? {});
function measureFullLines(root: ReactTestInstance) {
  const widths = [96, 87, 96];
  for (const [index, amount] of amounts(root).entries()) textLayout(amount, [widths[index]!]);
}

describe('Summary figures fit their card', () => {
  it('stacks the reported amounts when native text wraps in a narrow card, keeping every digit', () => {
    const root = render();
    for (const amount of amounts(root)) expect(amount.props.numberOfLines).toBe(0);
    resize(root, 320);
    // Native lays the first amount onto two lines in a 92dp column.
    textLayout(amounts(root)[0]!, [87, 9]);
    expect(direction(root)).toBe('column');
    expect(amounts(root).map((amount) => amount.children.join(''))).toEqual([
      '₹201,670.00',
      '₹69,726.68',
      '₹191,670.00',
    ]);
    expect(entries(root).map((entry) => entry.props.accessibilityLabel)).toEqual([
      'Spent: ₹201,670.00',
      'Your share: ₹69,726.68',
      'You paid: ₹191,670.00',
    ]);
  });

  it('does not let a late text measurement from older figures undo the current stacked layout', () => {
    const root = render([{ label: 'Spent', value: '₹1.00' }, figures[1]!, figures[2]!]);
    resize(root, 320);
    const olderLayout = amounts(root)[0]!.props.onTextLayout;
    act(() => screen!.update(element(figures)));
    textLayout(amounts(root)[0]!, [87, 9]);
    expect(direction(root)).toBe('column');

    act(() => olderLayout({ nativeEvent: { lines: [{ width: 43 }] } }));
    expect(direction(root)).toBe('column');
    expect(amounts(root)[0]!.children.join('')).toBe('₹201,670.00');
  });

  it('keeps fitting figures compact, reflows after a resize, and returns without toggling in place', () => {
    const root = render();
    resize(root, 412);
    measureFullLines(root);
    expect(direction(root)).toBe('row');

    resize(root, 320);
    expect(direction(root)).toBe('column');
    // The same text is now laid out on one full-width line in each stacked entry.
    measureFullLines(root);
    expect(direction(root)).toBe('column');

    resize(root, 412);
    measureFullLines(root);
    measureFullLines(root);
    expect(direction(root)).toBe('row');
    resize(root, 320);
    measureFullLines(root);
    expect(direction(root)).toBe('column');
  });

  it('retains native overflow evidence when wrapped lines omit spacing near the column edge', () => {
    const root = render();
    resize(root, 320);
    const label = root.find((node) => host(node, 'Text') && node.children.includes('Your share'));
    // Native wrapped the label; the pieces do not include the space at the line break.
    textLayout(label, [70, 18]);
    expect(direction(root)).toBe('column');
    textLayout(label, [90]);
    textLayout(label, [90]);
    expect(direction(root)).toBe('column');
    resize(root, 412);
    textLayout(label, [90]);
    expect(direction(root)).toBe('row');
  });

  it('uses native label widths as well as amount widths and forgets sizes when figures change', () => {
    const root = render();
    resize(root, 320);
    const label = root.find((node) => host(node, 'Text') && node.children.includes('Your share'));
    textLayout(label, [102]);
    expect(direction(root)).toBe('column');

    const short = [
      { label: 'Spent', value: '₹12.00' },
      { label: 'Share', value: '₹4.00' },
      { label: 'Paid', value: '₹12.00' },
    ];
    act(() => screen!.update(element(short)));
    for (const amount of amounts(root)) textLayout(amount, [52]);
    expect(direction(root)).toBe('row');
  });

  it.each(['light', 'dark'] as const)(
    'at enlarged text keeps labels, complete values and their semantic colors in %s',
    (mode) => {
      setWindow({ fontScale: 1.3 });
      const stats = figures.map((figure, index) => ({
        ...figure,
        tone: index === 1 ? ('negative' as const) : ('positive' as const),
      }));
      const root = render(stats, mode);
      resize(root, 320);
      expect(direction(root)).toBe('column');
      const beforeScale = amounts(root)[0]!.props.onTextLayout;
      setWindow({ fontScale: 2 });
      act(() => screen!.update(element(stats, mode)));
      for (const amount of amounts(root)) textLayout(amount, [190]);
      expect(direction(root)).toBe('column');
      expect(entries(root).map((entry) => entry.props.accessibilityLabel)).toEqual([
        'Spent: ₹201,670.00',
        'Your share: ₹69,726.68',
        'You paid: ₹191,670.00',
      ]);
      expect(amounts(root).map((amount) => flatten(amount.props.style).color)).toEqual([
        getSemanticTokens(mode).status.positive,
        getSemanticTokens(mode).status.negative,
        getSemanticTokens(mode).status.positive,
      ]);
      setWindow({ fontScale: 1 });
      act(() => screen!.update(element(stats, mode)));
      resize(root, 412);
      measureFullLines(root);
      act(() => beforeScale({ nativeEvent: { lines: [{ width: 1000 }] } }));
      expect(direction(root)).toBe('row');
    },
  );

  it('allows an amount longer than the whole card to wrap without a line limit or font shrinking', () => {
    const value = '₹123,456,789,012,345,678,901,234,567,890.56';
    const root = render([{ label: 'Spent', value }, figures[1]!, figures[2]!]);
    resize(root, 320);
    textLayout(amounts(root)[0]!, [87, 87, 87, 87, 7]);
    expect(direction(root)).toBe('column');
    textLayout(amounts(root)[0]!, [275, 80]);
    const amount = amounts(root)[0]!;
    expect(amount.children.join('')).toBe(value);
    expect(amount.props.numberOfLines).toBe(0);
    expect(amount.props.adjustsFontSizeToFit).not.toBe(true);
    expect(flatten(amount.props.style)).toMatchObject({ maxWidth: '100%', fontSize: 15 });
    expect(entries(root)[0]!.props.style.flexWrap).toBe('wrap');
    expect(direction(root)).toBe('column');
  });
});
