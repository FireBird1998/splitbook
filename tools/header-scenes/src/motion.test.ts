import { expect, it } from 'vitest';
import type { SceneVector } from '@splitbook/shared/header-scene-art';
import { elementMotion, motionRules } from './motion';

const node = (classes: string, extra: Partial<SceneVector> = {}): SceneVector => ({
  tag: 'g',
  props: {},
  classes: classes.split(' '),
  ...extra,
});
const at = (curve: { at: number[]; to: number[] } | undefined, point: number) => {
  for (let i = 1; i < curve!.at.length; i++)
    if (point <= curve!.at[i]!) {
      const span = curve!.at[i]! - curve!.at[i - 1]!;
      return (
        curve!.to[i - 1]! +
        ((curve!.to[i]! - curve!.to[i - 1]!) * (point - curve!.at[i - 1]!)) / (span || 1)
      );
    }
  return curve!.to.at(-1)!;
};

it('reads a straight slide and fade as the CSS writes them', () => {
  const rules = motionRules(
    '.vq .drop { opacity: 0; animation: fall 1.2s linear infinite; } @keyframes fall { 0% { transform: translateY(-2px); opacity: 0 } 30% { opacity: 0.85 } 100% { transform: translateY(8px); opacity: 0 } }',
  );
  const { tracks, rest } = elementMotion(node('drop'), rules);
  // It is hidden until it runs.
  expect(rest).toBe(0);
  expect(tracks).toEqual([
    {
      seconds: 1.2,
      y: { at: [0, 1], to: [-2, 8] },
      opacity: { at: [0, 0.3, 1], to: [0, 0.85, 0] },
    },
  ]);
});

it('starts an element part-way through its cycle for a negative delay', () => {
  const rules = motionRules(
    '.vq .drop { animation: fall 1s linear infinite; } @keyframes fall { from { transform: translateY(0) } to { transform: translateY(10px) } }',
  );
  const [track] = elementMotion(node('drop', { delaySeconds: -0.25 }), rules).tracks;
  // A quarter in: it starts at 2.5, reaches the bottom three quarters later, and restarts.
  expect(at(track!.y, 0)).toBeCloseTo(2.5);
  expect(at(track!.y, 0.74)).toBeCloseTo(9.9, 1);
  expect(at(track!.y, 0.76)).toBeCloseTo(0.1, 0);
  expect(at(track!.y, 1)).toBeCloseTo(2.5);
});

it('holds each step of a stepped walk and then jumps', () => {
  const rules = motionRules(
    '.vq .bob { animation: bob 0.56s steps(2, jump-none) infinite; } @keyframes bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }',
    '.vq .wing { animation: flap 0.8s steps(1) infinite; } @keyframes flap { 0% { opacity: 1 } 50%, 100% { opacity: 0 } }',
  );
  const bob = elementMotion(node('bob'), rules).tracks[0]!.y;
  expect(
    [0.1, 0.24, 0.26, 0.5, 0.74, 0.76, 0.9].map((point) => Math.round(at(bob, point))),
  ).toEqual([0, 0, -1, -1, -1, 0, 0]);
  const flap = elementMotion(node('wing'), rules).tracks[0]!.opacity;
  expect([0.1, 0.49, 0.51, 0.9].map((point) => Math.round(at(flap, point)))).toEqual([1, 1, 0, 0]);
});

it('draws the easing into the stops, between each pair of keyframes', () => {
  const rules = motionRules(
    '.vq .boat { animation: bob 5s ease-in-out infinite; } @keyframes bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(2px) } }',
  );
  const y = elementMotion(node('boat'), rules).tracks[0]!.y;
  // Half-way up at a quarter of the cycle, but slow at both ends of each stretch.
  expect(at(y, 0.25)).toBeCloseTo(1, 2);
  expect(at(y, 0.05)).toBeLessThan(0.1);
  expect(at(y, 0.45)).toBeGreaterThan(1.9);
  expect(at(y, 0.5)).toBeCloseTo(2);
});

it('lets a later class change the period, delay and direction, and a node its own pace', () => {
  const rules = motionRules(
    '.vq .koi { animation: swim 16s linear infinite; } .vq .koi2 { animation-duration: 22s; animation-delay: -11s; animation-direction: reverse; } @keyframes swim { from { transform: translate(0, 0) } to { transform: translate(20px, 0) } }',
  );
  const [second] = elementMotion(node('koi koi2'), rules).tracks;
  expect(second!.seconds).toBe(22);
  // Backwards from the half-way point: it swims from 10 down to 0, then from 20.
  expect(at(second!.x, 0)).toBeCloseTo(10);
  expect(at(second!.x, 0.49)).toBeCloseTo(0.2, 1);
  expect(at(second!.x, 0.52)).toBeCloseTo(19.6, 0);
  expect(elementMotion(node('koi', { durationSeconds: 9 }), rules).tracks[0]!.seconds).toBe(9);
});

it('keeps a night rule apart and ignores the reduced-motion block', () => {
  const rules = motionRules(
    '.vq.t-night .wins { animation: flicker 7s linear infinite; } @keyframes flicker { 0%, 100% { opacity: 0.9 } 50% { opacity: 0.45 } } @media (prefers-reduced-motion: reduce) { .vq .wins { animation: none !important; } }',
  );
  const { tracks } = elementMotion(node('wins'), rules);
  expect(tracks).toHaveLength(1);
  expect(tracks[0]!.time).toBe('night');
  // The light is already drawn in full: the flicker dims it to half and back.
  expect(tracks[0]!.opacity).toEqual({ at: [0, 0.5, 1], to: [1, 0.5, 1] });
  expect(elementMotion(node('roof'), rules).tracks).toEqual([]);
});

it("marks a turn about the element's own middle and refuses what it cannot play", () => {
  const rules = motionRules(
    '.vq .rip { transform-box: fill-box; transform-origin: center; animation: grow 4s linear infinite; } @keyframes grow { from { transform: scale(0.5) } to { transform: scale(1.5) } }',
    '.vq .late { animation: grow 4s linear infinite; animation-delay: 2s; }',
    '.vq .odd { animation: lean 4s linear infinite; } @keyframes lean { from { transform: skewX(0deg) } to { transform: skewX(10deg) } }',
  );
  expect(elementMotion(node('rip'), rules).tracks[0]).toMatchObject({
    centred: true,
    scale: { at: [0, 1], to: [0.5, 1.5] },
  });
  expect(() => elementMotion(node('late'), rules)).toThrow(/positive animation delay/);
  expect(() => elementMotion(node('odd'), rules)).toThrow(/Unsupported Header scene transform/);
});
