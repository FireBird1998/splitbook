import type { ReactTestRendererJSON } from 'react-test-renderer';

type Node = ReactTestRendererJSON;
type Style = Record<string, unknown>;

/**
 * How tall a rendered host tree lays out, worked out from its styles as Yoga stacks boxes:
 * fixed heights, minimum heights, padding, borders, margins and gaps, columns summed and rows
 * taking their tallest child. Text is one line of its line height, which Android scales with
 * the text size (`fontScale`); an icon is its size. Absolutely positioned children take no room.
 *
 * Given the `width` the tree lays out in, a row that wraps (`flexWrap: 'wrap'`) breaks into
 * lines where its children no longer fit, by their estimated widths (`layoutWidth`): enough to
 * see that an amount and a badge go onto two lines on a narrow phone or at large text. Text
 * itself never wraps here, so keep text in a comparison to one line, and check anything that
 * wraps on a device too.
 *
 * Enough to show that content takes its skeleton's place at the same height (#331).
 */
export function layoutHeight(node: Node | string | null, fontScale = 1, width?: number): number {
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
          vertical(style);
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
  const children = inFlow(node);
  /** The room inside this box, when its own width is known. */
  const inner = width === undefined ? undefined : width - horizontal(style);
  const outer = (child: Node, room: number | undefined) => {
    const own = flatten(child.props.style);
    return (
      layoutHeight(child, fontScale, room) +
      edge(own, 'Top', 'margin') +
      edge(own, 'Bottom', 'margin')
    );
  };
  const row = style.flexDirection === 'row';
  if (row && style.flexWrap === 'wrap' && inner !== undefined) {
    // Lines of children, each as wide as it would be on its own; a flexible child (flex: 1)
    // starts at nothing, so it never starts a line.
    const across = number(style.columnGap ?? style.gap);
    const down = number(style.rowGap ?? style.gap);
    const lines: number[] = [];
    let used = -1;
    for (const child of children) {
      const own = flatten(child.props.style);
      const span = number(own.flex) > 0 ? 0 : layoutWidth(child, fontScale, inner);
      const height = outer(child, Math.min(span, inner));
      if (used < 0 || used + across + span > inner) {
        lines.push(height);
        used = span;
      } else {
        lines[lines.length - 1] = Math.max(lines[lines.length - 1]!, height);
        used += across + span;
      }
    }
    return box(
      lines.reduce((sum, height) => sum + height, 0) + down * Math.max(0, lines.length - 1),
    );
  }
  const heights = children.map((child) => outer(child, childWidth(child, row, inner, fontScale)));
  const gap = number(row ? 0 : (style.rowGap ?? style.gap));
  const content = row
    ? Math.max(0, ...heights)
    : heights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, heights.length - 1);
  return box(content);
}

/**
 * How wide a host tree is on its own, estimated: text from its characters (IBM Plex Mono's
 * advance is 0.6 of the font size, Outfit's taken as 0.55), with fixed and percentage widths,
 * padding, borders and gaps as Yoga adds them. `room` is the width a percentage is of.
 */
export function layoutWidth(node: Node | string | null, fontScale = 1, room = 0): number {
  if (node === null || typeof node === 'string') return 0;
  const style = flatten(node.props.style);
  if (style.display === 'none') return 0;
  const minimum = typeof style.minWidth === 'number' ? style.minWidth : 0;
  if (typeof style.width === 'number') return style.width;
  if (typeof style.width === 'string' && style.width.endsWith('%'))
    return (room * parseFloat(style.width)) / 100;
  let content: number;
  switch (node.type) {
    case 'Text':
    case 'AnimatedText': {
      const characters = text(node).length;
      const advance = String(style.fontFamily ?? '').includes('Mono') ? 0.6 : 0.55;
      content =
        characters * (number(style.fontSize) * fontScale * advance + number(style.letterSpacing));
      break;
    }
    case 'Ionicons':
      content = number(node.props.size);
      break;
    case 'ActivityIndicator':
      content = node.props.size === 'large' ? 36 : 20;
      break;
    default: {
      const inner = room - horizontal(style);
      const widths = inFlow(node).map((child) => layoutWidth(child, fontScale, inner));
      content =
        style.flexDirection === 'row'
          ? widths.reduce((sum, width) => sum + width, 0) +
            number(style.columnGap ?? style.gap) * Math.max(0, widths.length - 1)
          : Math.max(0, ...widths);
    }
  }
  return Math.max(minimum, content + horizontal(style));
}

/** Every host node under `node`, depth first, whose props match. */
export function findHosts(
  node: Node | Node[] | string | null,
  match: (props: Record<string, unknown>, type: string) => boolean,
): Node[] {
  if (node === null || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap((child) => findHosts(child, match));
  return [
    ...(match(node.props, node.type) ? [node] : []),
    ...(node.children ?? []).flatMap((child) => findHosts(child, match)),
  ];
}

/** A host node's style as one object: arrays merged, and a Pressable's style function unpressed. */
export function flatten(style: unknown): Style {
  if (typeof style === 'function') return flatten(style({ pressed: false }));
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return style && typeof style === 'object' ? (style as Style) : {};
}

const number = (value: unknown) => (typeof value === 'number' ? value : 0);

/** The children that take room: not text, not absolutely positioned. */
const inFlow = (node: Node) =>
  (node.children ?? []).filter(
    (child): child is Node =>
      typeof child !== 'string' && flatten(child.props.style).position !== 'absolute',
  );

/** All the text in a node, its nested runs included. */
const text = (node: Node | string): string =>
  typeof node === 'string' ? node : (node.children ?? []).map(text).join('');

/**
 * The width a child gets: its own fixed or percentage width; in a column, the column's width;
 * in a row, its estimated width, or what is left for a flexible child. Unknown without `inner`.
 */
function childWidth(child: Node, row: boolean, inner: number | undefined, fontScale: number) {
  if (inner === undefined) return undefined;
  const own = flatten(child.props.style);
  if (typeof own.width === 'number') return own.width;
  if (typeof own.width === 'string' && own.width.endsWith('%'))
    return (inner * parseFloat(own.width)) / 100;
  if (!row || number(own.flex) > 0) return inner;
  return Math.min(inner, layoutWidth(child, fontScale, inner));
}

/** One side's padding or margin, from the most specific of its properties. */
function edge(style: Style, side: 'Top' | 'Bottom' | 'Left' | 'Right', kind: 'padding' | 'margin') {
  const axis = side === 'Top' || side === 'Bottom' ? 'Vertical' : 'Horizontal';
  return number(style[`${kind}${side}`] ?? style[`${kind}${axis}`] ?? style[kind]);
}

function vertical(style: Style) {
  return (
    number(style.borderTopWidth ?? style.borderWidth) +
    number(style.borderBottomWidth ?? style.borderWidth)
  );
}

/** Horizontal padding and borders together. */
function horizontal(style: Style) {
  return (
    edge(style, 'Left', 'padding') +
    edge(style, 'Right', 'padding') +
    number(style.borderLeftWidth ?? style.borderWidth) +
    number(style.borderRightWidth ?? style.borderWidth)
  );
}
