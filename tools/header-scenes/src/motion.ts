/**
 * Reads the web's CSS animation rules and bakes each one into plain stops that Android can play
 * with a linear clock. The CSS stays the single source of timing: nothing is typed twice.
 */
import type { SceneVector } from '@splitbook/shared/header-scene-art';

/** One animated property over one cycle: the value at each point of the cycle (0 to 1). */
export interface Curve {
  at: number[];
  to: number[];
}
/** One CSS animation on one element, phase and direction already applied. */
export interface Track {
  seconds: number;
  /** Runs only at this time of day (the web's `.t-night` rules). */
  time?: 'night';
  /** Scene units. */
  x?: Curve;
  y?: Curve;
  scale?: Curve;
  /** Degrees. */
  rotate?: Curve;
  opacity?: Curve;
  /** Scale and rotate turn about the element's own middle, not its group's origin. */
  centred?: boolean;
}

type Declarations = Record<string, string>;
interface Rule {
  time?: 'night';
  /** The last class of the selector: the element the rule styles. */
  target: string;
  declarations: Declarations;
}
interface Keyframe {
  at: number;
  declarations: Declarations;
}
export interface MotionRules {
  rules: Rule[];
  keyframes: Map<string, Keyframe[]>;
}

const declarations = (body: string): Declarations =>
  Object.fromEntries(
    body
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(':');
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
      }),
  );

/** Reads the animation rules out of the shared and scene CSS, in cascade order. */
export function motionRules(...sheets: string[]): MotionRules {
  const rules: Rule[] = [];
  const keyframes = new Map<string, Keyframe[]>();
  for (const sheet of sheets) {
    const css = sheet
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Reduced motion and the calm switch are the phone's own Motion rules, not timing.
      .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const plain = css.replace(
      /@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g,
      (_, name: string, body: string) => {
        const frames: Keyframe[] = [];
        for (const frame of body.matchAll(/([^{}]+)\{([^{}]*)\}/g))
          for (const selector of frame[1]!.split(','))
            frames.push({
              at:
                selector.trim() === 'from'
                  ? 0
                  : selector.trim() === 'to'
                    ? 1
                    : Number.parseFloat(selector) / 100,
              declarations: declarations(frame[2]!),
            });
        keyframes.set(
          name,
          frames.sort((a, b) => a.at - b.at),
        );
        return '';
      },
    );
    for (const rule of plain.matchAll(/([^{}@]+)\{([^{}]*)\}/g))
      for (const selector of rule[1]!.split(',')) {
        // Only a rule that ends on a class styles a moving element; `.wins polygon` and the like
        // colour shapes and are handled where the pictures are drawn.
        const match = /^\.vq(\.t-night)?(?:\s+\.[\w-]+)*\s+\.([\w-]+)$/.exec(selector.trim());
        if (match)
          rules.push({
            ...(match[1] ? { time: 'night' as const } : {}),
            target: match[2]!,
            declarations: declarations(rule[2]!),
          });
      }
  }
  return { rules, keyframes };
}

const bezier = (x1: number, y1: number, x2: number, y2: number) => (progress: number) => {
  const curve = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (curve(middle, x1, x2) < progress) low = middle;
    else high = middle;
  }
  return curve((low + high) / 2, y1, y2);
};
const EASINGS: Record<string, (progress: number) => number> = {
  ease: bezier(0.25, 0.1, 0.25, 1),
  'ease-in-out': bezier(0.42, 0, 0.58, 1),
  'ease-out': bezier(0, 0, 0.58, 1),
  'ease-in': bezier(0.42, 0, 1, 1),
};
/** How many straight pieces stand in for one eased stretch between two keyframes. */
const EASED_PIECES = 8;
/** The width of a jump: two stops this far apart read as an instant change. */
const JUMP = 0.0005;

interface Animation {
  name: string;
  seconds: number;
  easing: string;
  delay: number;
  reverse: boolean;
}
function shorthand(value: string): Partial<Animation> {
  const easing =
    /steps\([^)]*\)|cubic-bezier\([^)]*\)|ease-in-out|ease-out|ease-in|ease|linear/.exec(
      value,
    )?.[0];
  const rest = value.replace(/steps\([^)]*\)|cubic-bezier\([^)]*\)/, '').split(/\s+/);
  const times = rest
    .filter((word) => /^-?[\d.]+s$/.test(word))
    .map((word) => Number.parseFloat(word));
  const name = rest.find(
    (word) =>
      !/^-?[\d.]+s$/.test(word) &&
      !['infinite', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'reverse'].includes(
        word,
      ) &&
      word !== '',
  );
  return {
    ...(name ? { name } : {}),
    ...(times[0] !== undefined ? { seconds: times[0] } : {}),
    ...(times[1] !== undefined ? { delay: times[1] } : {}),
    easing: easing ?? 'ease',
    ...(rest.includes('reverse') ? { reverse: true } : {}),
  };
}

function transformValues(value: string | undefined) {
  const out: { x?: number; y?: number; scale?: number; rotate?: number } = {};
  if (value === undefined) return out;
  for (const part of value.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const numbers = part[2]!.split(',').map((text) => Number.parseFloat(text));
    if (part[1] === 'translate') {
      out.x = numbers[0]!;
      out.y = numbers[1] ?? 0;
    } else if (part[1] === 'translateX') out.x = numbers[0]!;
    else if (part[1] === 'translateY') out.y = numbers[0]!;
    else if (part[1] === 'scale') out.scale = numbers[0]!;
    else if (part[1] === 'rotate') out.rotate = numbers[0]!;
    else throw new Error(`Unsupported Header scene transform: ${part[1]}`);
  }
  return out;
}

const round = (value: number) => Math.round(value * 10000) / 10000;

/** One property's keyframes as straight pieces, with the easing drawn into them. */
function bake(points: [number, number][], easing: string): [number, number][] {
  const out: [number, number][] = [points[0]!];
  const steps = /^steps\((\d+)(?:,\s*([\w-]+))?\)$/.exec(easing);
  for (let i = 1; i < points.length; i++) {
    const [fromAt, from] = points[i - 1]!;
    const [toAt, to] = points[i]!;
    if (toAt === fromAt || from === to) {
      out.push([toAt, to]);
      continue;
    }
    if (steps) {
      const count = Number(steps[1]);
      // `jump-none` shows both ends; the default holds the start and jumps at the end.
      const levels = steps[2] === 'jump-none' ? count - 1 : count;
      for (let step = 1; step <= count; step++) {
        const edge = fromAt + ((toAt - fromAt) * step) / count;
        const before = from + ((to - from) * (step - 1)) / levels;
        const after = step === count ? to : from + ((to - from) * step) / levels;
        if (steps[2] === 'jump-none' && step === count) {
          out.push([edge, Math.min(Math.max(before, Math.min(from, to)), Math.max(from, to))]);
          continue;
        }
        out.push([edge - JUMP, before], [edge, after]);
      }
      continue;
    }
    const ease = EASINGS[easing];
    if (!ease) {
      if (easing !== 'linear') throw new Error(`Unsupported Header scene easing: ${easing}`);
      out.push([toAt, to]);
      continue;
    }
    for (let piece = 1; piece <= EASED_PIECES; piece++) {
      const progress = piece / EASED_PIECES;
      out.push([fromAt + (toAt - fromAt) * progress, from + (to - from) * ease(progress)]);
    }
  }
  return out;
}

const valueAt = (points: [number, number][], at: number) => {
  for (let i = 1; i < points.length; i++) {
    const [fromAt, from] = points[i - 1]!;
    const [toAt, to] = points[i]!;
    if (at <= toAt)
      return toAt === fromAt ? to : from + ((to - from) * (at - fromAt)) / (toAt - fromAt);
  }
  return points.at(-1)![1];
};

/** Starts the cycle `phase` of the way in and optionally runs it backwards. */
function shift(points: [number, number][], phase: number, reverse: boolean): Curve {
  const source: [number, number][] = reverse
    ? points.map(([at, value]) => [1 - at, value] as [number, number]).reverse()
    : points;
  let all: [number, number][] = source;
  if (phase > 0) {
    const edge = valueAt(source, phase);
    const first = source[0]![1];
    const last = source.at(-1)![1];
    all = [
      [0, edge],
      // The rest of the cycle, up to its end...
      ...source
        .filter(([at]) => at > phase)
        .map(([at, value]) => [at - phase, value] as [number, number]),
      // ...then back to its start, as a jump when the two ends differ...
      ...(first === last ? [] : [[1 - phase + JUMP, first] as [number, number]]),
      // ...and on to where this element began.
      ...source
        .filter(([at]) => at > JUMP && at < phase)
        .map(([at, value]) => [at + 1 - phase, value] as [number, number]),
      [1, edge],
    ];
  }
  const curve: Curve = { at: [], to: [] };
  for (const [at, value] of all) {
    const last = curve.at.length - 1;
    // Two stops at one point would not be a valid range; keep them a hair apart.
    const place = last >= 0 && at <= curve.at[last]! ? curve.at[last]! + JUMP / 10 : at;
    curve.at.push(round(Math.min(place, 1)));
    curve.to.push(round(value));
  }
  // Drop stops that lie on the straight line between their neighbours.
  for (let i = curve.at.length - 2; i > 0; i--) {
    const span = curve.at[i + 1]! - curve.at[i - 1]!;
    const expected =
      curve.to[i - 1]! +
      ((curve.to[i + 1]! - curve.to[i - 1]!) * (curve.at[i]! - curve.at[i - 1]!)) / span;
    if (Math.abs(expected - curve.to[i]!) < 0.0002) {
      curve.at.splice(i, 1);
      curve.to.splice(i, 1);
    }
  }
  return curve;
}

/**
 * The animations the CSS gives one element, outermost rule first. A night rule is its own track.
 * `rest` is the opacity the element has when nothing runs.
 */
export function elementMotion(
  node: SceneVector,
  { rules, keyframes }: MotionRules,
): { tracks: Track[]; rest: number } {
  const tracks: Track[] = [];
  let rest = 1;
  for (const time of [undefined, 'night'] as const) {
    const merged: Declarations = {};
    let matched = false;
    for (const rule of rules) {
      if (!(node.classes ?? []).includes(rule.target)) continue;
      if (rule.time && rule.time !== time) continue;
      if (rule.time === time) matched ||= 'animation' in rule.declarations;
      Object.assign(merged, rule.declarations);
    }
    if (time === undefined && merged.opacity !== undefined) rest = Number(merged.opacity);
    if (!merged.animation && !merged['animation-name']) continue;
    // The night pass only adds a track when a night rule itself animates.
    if (time === 'night' && !matched) continue;
    const animation: Animation = {
      name: '',
      seconds: 0,
      easing: 'ease',
      delay: 0,
      reverse: false,
      ...shorthand(merged.animation ?? ''),
    };
    if (merged['animation-name']) animation.name = merged['animation-name'];
    if (merged['animation-duration'])
      animation.seconds = Number.parseFloat(merged['animation-duration']);
    if (merged['animation-delay']) animation.delay = Number.parseFloat(merged['animation-delay']);
    if (merged['animation-direction'] === 'reverse') animation.reverse = true;
    if (node.durationSeconds !== undefined) animation.seconds = node.durationSeconds;
    if (node.delaySeconds !== undefined) animation.delay = node.delaySeconds;
    if (animation.name === 'none') continue;
    const frames = keyframes.get(animation.name);
    if (!frames || !animation.seconds)
      throw new Error(`Header scene animation has no keyframes or period: ${animation.name}`);
    if (animation.delay > 0) throw new Error('A positive animation delay is not supported');
    const track: Track = {
      seconds: animation.seconds,
      ...(time ? { time } : {}),
      ...(merged['transform-box'] === 'fill-box' ? { centred: true } : {}),
    };
    const phase = (((-animation.delay / animation.seconds) % 1) + 1) % 1;
    const resting = { x: 0, y: 0, scale: 1, rotate: 0, opacity: time ? 1 : rest };
    for (const property of ['x', 'y', 'scale', 'rotate', 'opacity'] as const) {
      const points: [number, number][] = [];
      for (const frame of frames) {
        const value =
          property === 'opacity'
            ? frame.declarations.opacity === undefined
              ? undefined
              : Number(frame.declarations.opacity)
            : transformValues(frame.declarations.transform)[property];
        if (value !== undefined) points.push([frame.at, value]);
        // A keyframe that sets a transform without this part of it holds the part at rest.
        else if (property !== 'opacity' && frame.declarations.transform !== undefined)
          points.push([frame.at, resting[property]]);
      }
      if (!points.length) continue;
      if (points[0]![0] > 0) points.unshift([0, resting[property]]);
      if (points.at(-1)![0] < 1) points.push([1, resting[property]]);
      const curve = shift(bake(points, animation.easing), phase, animation.reverse);
      if (
        curve.to.every((value) => Math.abs(value - resting[property]) < 0.0002) &&
        property !== 'opacity'
      )
        continue;
      // A night rule's opacity multiplies light that is already drawn: its brightest point is 1.
      if (time && property === 'opacity') {
        const brightest = Math.max(...curve.to);
        curve.to = curve.to.map((value) => round(value / brightest));
      }
      track[property] = curve;
    }
    tracks.push(track);
  }
  return { tracks, rest };
}
