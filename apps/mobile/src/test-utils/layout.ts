import type { ReactTestInstance, ReactTestRendererJSON } from 'react-test-renderer';
import { scaledSp } from '../ui/compact/scale';

type Node = ReactTestRendererJSON;
type Style = Record<string, unknown>;

/**
 * How tall a rendered host tree lays out, worked out from its styles as Yoga stacks boxes:
 * fixed heights, minimum heights, padding, borders, margins and gaps, columns summed and rows
 * taking their tallest child. A line of text is its line height, which Android scales with the
 * text size (`fontScale`) by its non-linear curves (`scaledSp`); an icon is its size. Absolutely
 * positioned children take no room. Calibrated against an emulator at 100% and at 130% (#331).
 *
 * Without a `width`, text is one line and rows never wrap. Given the width the tree lays out
 * in, text wraps onto as many lines as its estimated width needs (up to `numberOfLines`), and a
 * row that wraps (`flexWrap: 'wrap'`) breaks into lines where its children no longer fit, by
 * their estimated widths (`layoutWidth`): enough to see that a note takes two lines, or that an
 * amount and a badge go onto two lines on a narrow phone or at large text. In a row, a flexible
 * child (`flex`) keeps its `minWidth`, and children that shrink (`flexShrink`) give up what
 * overflows the row, so their text wraps. The widths are estimates from character counts, so
 * check anything close to a line's end on a device too.
 *
 * Enough to show that content takes its skeleton's place at the same height (#331). `watch`
 * hears each text with the width it lays out in, and each row its children run past, as
 * `unreadText` reads them.
 */
export function layoutHeight(
  node: Node | string | null,
  fontScale = 1,
  width?: number,
  watch?: LayoutWatch,
): number {
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
    case 'AnimatedText': {
      // Wrapped onto as many lines as its estimated width needs, up to `numberOfLines`.
      const room = width === undefined ? 0 : width - horizontal(style);
      // A box sized to its text gets its width back through sums that can lose a hair: a text
      // within a millionth of a dp of its room still fits. White space ending a line may run
      // past its room, as Android lays it out.
      const needed =
        room > 0 ? Math.max(1, Math.ceil(textWidth(node, fontScale, true) / room - 1e-6)) : 1;
      const limit = Number(node.props.numberOfLines) || Infinity;
      if (width !== undefined) watch?.text?.(node, room);
      return box(scaledSp(number(style.lineHeight), fontScale) * Math.min(needed, limit));
    }
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
      layoutHeight(child, fontScale, room, watch) +
      edge(own, 'Top', 'margin') +
      edge(own, 'Bottom', 'margin')
    );
  };
  const row = style.flexDirection === 'row';
  const across = number(style.columnGap ?? style.gap);
  /** A child that takes what its line leaves (flex: 1), starting from its minimum width. */
  const flexible = (child: Node) => number(flatten(child.props.style).flex) > 0;
  /**
   * A child's own width in a row: fixed, a percentage, as wide as its content, or a flexible
   * child's minimum.
   */
  const span = (child: Node) =>
    Math.min(
      inner!,
      flexible(child)
        ? number(flatten(child.props.style).minWidth)
        : childWidth(child, true, inner, fontScale)!,
    );
  /** How much a child gives up when its line overflows (flexShrink). */
  const shrink = (child: Node) =>
    flexible(child) ? 0 : number(flatten(child.props.style).flexShrink);
  /**
   * Children on one line of a row: each flexible one gets an equal part of what's left. When
   * the line overflows, the children that shrink give up the excess in proportion to their
   * widths, as Yoga shrinks them: a sentence beside an icon wraps rather than run past the row.
   */
  const line = (members: Node[]) => {
    const fixed = members.filter((child) => !flexible(child));
    const gaps = across * Math.max(0, members.length - 1);
    const left = inner! - fixed.reduce((sum, child) => sum + span(child), 0) - gaps;
    const share = Math.max(0, left) / Math.max(1, members.length - fixed.length);
    const over = members.reduce((sum, child) => sum + span(child), gaps) - inner!;
    const giving = members.reduce((sum, child) => sum + shrink(child) * span(child), 0);
    const width = (child: Node) => {
      if (flexible(child)) return Math.max(share, span(child));
      if (over <= 0 || giving <= 0) return span(child);
      return Math.max(0, span(child) - (over * shrink(child) * span(child)) / giving);
    };
    // What still runs past the row once its children have shrunk as far as they can.
    const past = members.reduce((sum, child) => sum + width(child), gaps) - inner!;
    if (past > 0.5) watch?.overflow?.(node, past);
    return Math.max(0, ...members.map((child) => outer(child, width(child))));
  };
  if (row && inner !== undefined) {
    if (style.flexWrap !== 'wrap') return box(line(children));
    // Lines of children, each as wide as it would be on its own; a flexible child starts at
    // its minimum width, so one without a minimum never starts a line.
    const lines: Node[][] = [];
    let used = -1;
    for (const child of children) {
      const width = span(child);
      if (used < 0 || used + across + width > inner) {
        lines.push([child]);
        used = width;
      } else {
        lines[lines.length - 1]!.push(child);
        used += across + width;
      }
    }
    const down = number(style.rowGap ?? style.gap);
    return box(
      lines.reduce((sum, members) => sum + line(members), 0) + down * Math.max(0, lines.length - 1),
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
    case 'AnimatedText':
      content = textWidth(node, fontScale);
      break;
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

/** What `layoutHeight` tells a watcher as it lays a tree out. */
interface LayoutWatch {
  /** A text, and the room inside its box it lays out in. */
  text?: (node: Node, room: number) => void;
  /** A row whose children run `by` dp past its edge, even after shrinking. */
  overflow?: (row: Node, by: number) => void;
}

/**
 * The texts in a tree that don't read in full, as `layoutHeight` lays it out `width` wide at
 * this text size: one that needs more lines than it may take (`numberOfLines`), so its end is
 * cut; one with a word wider than its line, which Android breaks in two ("ALL-T / IME"); and
 * each text in a row whose children run past its edge. Each says why. Empty when every text
 * reads in full. With `cutOnce`, a text may end at its line limit, as a long name does below
 * 150% text (#332): only broken words and rows run past count. The widths are estimates (see
 * `layoutWidth`), so check close calls on a device.
 */
export function unreadText(
  node: Node | null,
  fontScale: number,
  width: number,
  { cutOnce = false }: { cutOnce?: boolean } = {},
) {
  const found = new Set<string>();
  const words = (text: Node) =>
    runs(text, {})
      .map(({ characters }) => characters)
      .join('');
  layoutHeight(node, fontScale, width, {
    text: (text, room) => {
      const said = words(text).replaceAll(hairSpace, '');
      // A text that stops growing (`maxFontSizeMultiplier`), as an avatar's initials do (#589).
      const scale = Math.min(fontScale, Number(text.props.maxFontSizeMultiplier) || Infinity);
      const lines = Math.max(1, Math.ceil(textWidth(text, scale, true) / room - 1e-6));
      const limit = Number(text.props.numberOfLines) || Infinity;
      if (lines > limit && !cutOnce)
        found.add(`"${said}" needs ${lines} lines, and may take ${limit}`);
      const widest = Math.max(
        0,
        ...runs(text, {}).flatMap(({ characters, style }) =>
          characters.split(/\s+/).map((word) => runWidth(word, style, scale)),
        ),
      );
      if (widest > room + 0.5)
        found.add(`"${said}" has a word ${Math.round(widest)}dp wide in ${Math.round(room)}dp`);
    },
    overflow: (row, by) => {
      for (const text of findHosts(row, (_props, type) => type === 'Text'))
        found.add(
          `"${words(text).replaceAll(hairSpace, '')}" runs ${Math.round(by)}dp past its row`,
        );
    },
  });
  return [...found];
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

/** The room to spare a label as wide as its words keeps after them (`CompactText`'s `spare`). */
export const hairSpace = String.fromCodePoint(0x200a);

/**
 * The phones and text sizes the large-text checks lay screens out at (#639): 360×640 and
 * 412×915 dp, each at 130% and at 200% text.
 */
export const largeTextWindows = [
  { width: 360, height: 640, fontScale: 1.3 },
  { width: 360, height: 640, fontScale: 2 },
  { width: 412, height: 915, fontScale: 1.3 },
  { width: 412, height: 915, fontScale: 2 },
];

/**
 * The runs of each text under `root` whose words are `label`, with or without the room it keeps
 * to spare: `[label, hairSpace]` for a label that keeps it, `[label]` for one that doesn't.
 */
export function labelRuns(root: ReactTestInstance, label: string) {
  return root
    .findAll(
      (node) =>
        String(node.type) === 'Text' &&
        node.children.join('').replace(new RegExp(`${hairSpace}$`), '') === label,
    )
    .map((node) => node.children);
}

/**
 * Outfit's advance, as a fraction of the font size, by kind of character. Fitted to seven texts
 * measured on an emulator at 100% and 130% (#331), each within 3.5%: "0 expenses this month"
 * at 130% measured 171.0dp (this gives 171.3), "Updated 3:22 AM" at 100% 92.2dp (92.2), "QA U1
 * rerun 3 e" as a 130% heading 141.0dp (141.4); and "Shares differ by the smallest unit so the
 * whole amount is shared." fits a 349dp line at 100%, as it did there. The ellipsis and bold
 * come from the #332 device check (2026-10-07): "Refreshing…" in 13sp measured 72dp at 100%
 * (this gives 71.9) and 96.8dp at 130% (95.1). Home’s logo now uses the fixed
 * image width from brandLogoSize, read directly from its style rather than measured as text.
 */
function outfitAdvance(character: string) {
  // A hair space, as a badge keeps after its label: 4px of a 32px label there.
  if (character === hairSpace) return 0.125;
  if (character === '…') return 0.85;
  if ('iljtfr'.includes(character)) return 0.22;
  if ('mw'.includes(character)) return 0.8;
  if (/[a-z]/.test(character)) return 0.55;
  if (/[A-Z]/.test(character)) return 0.72;
  if (/[0-9]/.test(character)) return 0.6;
  return 0.25;
}

/**
 * One line of a text node's characters, estimated: IBM Plex Mono's advance is exactly 0.6 of
 * the font size; Outfit's comes from `outfitAdvance`. Letter spacing adds to each character.
 * A nested run, such as an amount in the money face inside a sentence, is measured in its own
 * size and face. `hanging` leaves out the white space it ends with, which a line may end past
 * its room in.
 */
function textWidth(node: Node, fontScale: number, hanging = false) {
  const parts = runs(node, {});
  // Only the white space the whole text ends with hangs.
  for (let index = parts.length - 1; hanging && index >= 0; index--) {
    parts[index]!.characters = parts[index]!.characters.trimEnd();
    if (parts[index]!.characters) break;
  }
  return parts.reduce(
    (width, { characters, style }) => width + runWidth(characters, style, fontScale),
    0,
  );
}

/** One run of characters in its style, estimated as `textWidth` measures them. */
function runWidth(characters: string, style: Style, fontScale: number) {
  const size = scaledSp(number(style.fontSize), fontScale);
  const mono = String(style.fontFamily ?? '').includes('Mono');
  // Outfit's bold is wider than the weights the advances were fitted to.
  const weight = String(style.fontFamily ?? '').includes('Bold') ? 1.09 : 1;
  return [...characters].reduce(
    (sum, character) =>
      sum + size * (mono ? 0.6 : outfitAdvance(character) * weight) + number(style.letterSpacing),
    0,
  );
}

/**
 * A text's characters in runs, each in the style its nesting gives it, and in capitals where
 * its style draws them so (an overline: "Changes in this Group" is about 8% wider in capitals).
 */
function runs(node: Node | string, outer: Style): { characters: string; style: Style }[] {
  if (typeof node === 'string')
    return [
      {
        characters: outer.textTransform === 'uppercase' ? node.toUpperCase() : node,
        style: outer,
      },
    ];
  const style = { ...outer, ...flatten(node.props.style) };
  return (node.children ?? []).flatMap((child) => runs(child, style));
}

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
