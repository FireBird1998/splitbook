import type { ReactTestRendererJSON } from 'react-test-renderer';

/**
 * How tall a rendered host tree lays out, worked out from its styles as Yoga stacks boxes:
 * fixed heights, minimum heights, padding, borders, margins and gaps, columns summed and rows
 * taking their tallest child. Text is one line of its line height, which Android scales with
 * the text size (`fontScale`); an icon is its size. It reads no widths, so it can't wrap text:
 * keep the text in a comparison to one line. Absolutely positioned children take no room.
 *
 * Enough to show that content takes its skeleton's place at the same height (#331); a device
 * screenshot is still the check for anything that wraps.
 */
export function layoutHeight(node: ReactTestRendererJSON | string | null, fontScale = 1): number {
  if (node === null || typeof node === 'string') return 0;
  const style = flatten(node.props.style);
  if (style.display === 'none') return 0;
  const box = (content: number) => {
    const height =
      typeof style.height === 'number'
        ? style.height
        : content +
          edge(style, 'Top', 'padding') +
          edge(style, 'Bottom', 'padding') +
          borders(style);
    return Math.max(height, typeof style.minHeight === 'number' ? style.minHeight : 0);
  };
  switch (node.type) {
    case 'Text':
    case 'AnimatedText':
      return box(number(style.lineHeight) * fontScale);
    case 'Ionicons':
      return box(number(node.props.size));
    case 'ActivityIndicator':
      return box(node.props.size === 'large' ? 36 : 20);
  }
  const children = (node.children ?? []).filter(
    (child): child is ReactTestRendererJSON =>
      typeof child !== 'string' && flatten(child.props.style).position !== 'absolute',
  );
  const outer = (child: ReactTestRendererJSON) => {
    const own = flatten(child.props.style);
    return (
      layoutHeight(child, fontScale) + edge(own, 'Top', 'margin') + edge(own, 'Bottom', 'margin')
    );
  };
  const heights = children.map(outer);
  const row = style.flexDirection === 'row';
  const gap = number(row ? 0 : (style.rowGap ?? style.gap));
  const content = row
    ? Math.max(0, ...heights)
    : heights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, heights.length - 1);
  return box(content);
}

/** Every host node under `node`, depth first, whose props match. */
export function findHosts(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
  match: (props: Record<string, unknown>, type: string) => boolean,
): ReactTestRendererJSON[] {
  if (node === null || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap((child) => findHosts(child, match));
  return [
    ...(match(node.props, node.type) ? [node] : []),
    ...(node.children ?? []).flatMap((child) => findHosts(child, match)),
  ];
}

/** A host node's style as one object: arrays merged, and a Pressable's style function unpressed. */
export function flatten(style: unknown): Record<string, unknown> {
  if (typeof style === 'function') return flatten(style({ pressed: false }));
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

const number = (value: unknown) => (typeof value === 'number' ? value : 0);

/** One side's padding or margin, from the most specific of its properties. */
function edge(style: Record<string, unknown>, side: 'Top' | 'Bottom', kind: 'padding' | 'margin') {
  return number(style[`${kind}${side}`] ?? style[`${kind}Vertical`] ?? style[kind]);
}

function borders(style: Record<string, unknown>) {
  return (
    number(style.borderTopWidth ?? style.borderWidth) +
    number(style.borderBottomWidth ?? style.borderWidth)
  );
}
