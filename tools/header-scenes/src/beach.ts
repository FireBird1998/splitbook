/** Beach, redrawn from the VoxelHeaders and Android Beach boards. */
import { Model, hash3, noise2, island, cubePoly, figure, layerOf, svgWrap } from './kit.ts';
import {
  waterfall,
  waterEffects,
  glowLayer,
  surroundingLayers,
  project as s,
} from './island-details.ts';

/** A stepped crown of drooping fronds, separate from its leaning trunk. */
function palm(m: Model, x: number, y: number, z: number, height: number, group: string) {
  for (let k = 0; k < height; k++) m.set(x + Math.floor(k / 4), y, z + k, 'palmTrunk');
  const cx = x + Math.floor((height - 1) / 4),
    top = z + height;
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      if (Math.abs(dx) + Math.abs(dy) <= 3) m.set(cx + dx, y + dy, top, 'palm', { g: group });
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
  ]) {
    for (let k = 1; k <= 4; k++) {
      const zz = top - Math.max(0, k - 2);
      m.set(cx + dx * k, y + dy * k, zz, k % 2 ? 'palm' : 'palmLight', { g: group });
      if (k === 4) m.set(cx + dx * k, y + dy * k, zz - 1, 'palm', { g: group });
      if (k < 4)
        m.set(cx + dx * k + (dy ? 1 : 0), y + dy * k + (dx ? 1 : 0), zz, 'palm', { g: group });
    }
  }
}
function hut(m: Model) {
  m.box(1, -14, 1, 9, -6, 1, 'plank');
  m.box(2, -13, 2, 8, -7, 5, 'hutWall');
  for (const x of [3, 6]) for (const z of [3, 4]) m.set(x, -7, z, 'glass', { win: true });
  for (const y of [-11, -9]) m.set(8, y, 3, 'glass', { win: true });
  m.set(5, -7, 2, 'door');
  m.set(5, -7, 3, 'door');
  // A low pyramidal thatch roof with one-cell eaves, leaving the windows exposed.
  for (let k = 0; k < 3; k++)
    m.box(1 + k, -14 + k, 6 + k, 9 - k, -6 - k, 6 + k, (x, y) =>
      (x + y + k) % 3 ? 'thatch' : 'thatchLight',
    );
}
function sailboat(): Model {
  const boat = new Model();
  boat.box(20, -8, 1, 24, -2, 1, 'boatRed', { g: 'boat' });
  boat.box(20, -8, 2, 24, -2, 2, 'white', { g: 'boat' });
  boat.box(21, -7, 3, 23, -3, 3, 'plank', { g: 'boat' });
  for (let z = 3; z <= 12; z++) boat.set(22, -5, z, 'mast', { g: 'boat' });
  // A tall white sail on one side of the mast, a smaller jib on the other.
  for (let z = 4; z <= 11; z++) {
    const span = Math.max(1, Math.floor((12 - z) / 2));
    for (let y = -2; y <= -5 + span; y++) boat.set(23, y, z, 'white', { g: 'boat' });
    for (let y = -6; y >= -6 - Math.floor(span * 0.6); y--)
      boat.set(22, y, z - 1, 'sailShade', { g: 'boat' });
  }
  return boat;
}

export function beachScene() {
  const m = new Model();
  const land = (x: number, y: number) =>
    Math.hypot((x + 2) / 21, (y + 2) / 20) + (noise2(x * 0.2, y * 0.2, 62) - 0.5) * 0.14;
  const hill = (x: number, y: number) =>
    Math.max(
      0,
      Math.round(
        10 *
          Math.min(
            1,
            Math.max(
              0,
              1.5 -
                Math.hypot((x + 12) / 7.5, (y + 2) / 7.5) +
                (noise2(x * 0.4, y * 0.4, 64) - 0.5) * 0.15,
            ),
          ),
      ),
    );
  island(m, {
    rx: 28,
    ry: 27,
    seed: 60,
    depth: 14,
    taper: 0.5,
    rough: 0.12,
    hTop: (x, y) => (land(x, y) > 1 ? 0 : Math.max(1, hill(x, y) + 1)),
    surf: (x, y, z) =>
      land(x, y) > 1
        ? 'sea'
        : z > 3
          ? hash3(x, y, z, 61) > 0.45
            ? 'grass'
            : 'rockMoss'
          : land(x, y) > 0.82
            ? 'beachSand'
            : 'lawn',
    sub: (x, y, z, top) =>
      top > 3 ? (z < top - 3 ? 'rock' : 'rockMoss') : z === 0 ? 'beachSand' : 'dirt',
  });
  // A vertical cascade in a narrow cleft, with a short stream across the sand below.
  for (let x = -13; x <= -10; x++)
    for (let y = 5; y <= 13; y++) for (let z = 2; z <= 14; z++) m.del(x, y, z);
  waterfall(m, -12, 4, 10, 1);
  for (let y = 4; y <= 13; y++) for (const x of [-12, -11]) m.set(x, y, 1, 'fall');
  hut(m);
  palm(m, -20, 5, 2, 9, 'sway');
  palm(m, 13, -16, 2, 9, 'sway2');
  palm(m, -5, -16, 2, 8, 'sway');
  palm(m, 3, 2, 2, 5, 'sway2');
  // The red-and-white beach parasol is a prominent landmark beside the hut.
  m.box(8, 6, 2, 8, 6, 5, 'timberD');
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > 3) continue;
      m.set(
        8 + dx,
        6 + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) < 2 ? 6 : 5,
        (dx + dy) % 2 ? 'white' : 'boatRed',
      );
    }
  // Jetty from the sandy bank to the moored boat.
  m.box(13, 1, 1, 26, 3, 1, 'plank');
  for (const x of [14, 20, 25]) for (const y of [1, 3]) m.box(x, y, -2, x, y, 1, 'timberD');
  for (const [x, y] of [
    [-21, 13],
    [-7, 16],
    [12, 14],
    [8, 9],
  ])
    m.set(x, y, 2, 'stone');
  // The board's large lantern cube on a low wooden post.
  m.set(-1, 8, 2, 'timberD');
  m.set(-1, 8, 3, 'timberD');
  m.set(-1, 8, 4, 'lamp', { lit: true });
  for (const [x, y] of [
    [-10, 2],
    [-7, 5],
    [-5, -1],
    [3, -16],
    [11, -8],
  ]) {
    const z = m.top(x, y);
    if (z !== null) {
      m.set(x, y, z + 1, 'leafB');
      m.set(x + 1, y, z + 1, 'leafA');
    }
  }
  const falls: [number, number, number][] = [
    [-12, 13, 1],
    [-7, 26, 0],
    [27, -2, 0],
  ];
  waterfall(m, -7, 26, 0, -9);
  waterfall(m, 27, -2, 0, -9);
  // The hull and sail are voxels in the same visibility solution as the water and jetty.
  for (const v of sailboat().v.values()) m.set(v.x, v.y, v.z, v.m, { g: v.g });
  const main = layerOf(m, 4);
  const [vx, vy] = s(13.5, -5.25, 4),
    [cx, cy] = s(-13, 13, 2);
  let fx = waterEffects(m, s, falls, 65);
  fx += `<g class="bx-walk" style="animation-delay: -3s"><g class="wbob">${figure(vx, vy, '#e9e2d0', '#4f6f8f', cubePoly(vx, vy - 9.3, 3.5, '#dcc48d'))}</g></g>`;
  fx += `<g class="bx-crab">${cubePoly(cx, cy, 1.4, '#c9553f')}${cubePoly(cx - 2, cy - 1, 0.7, '#e07050')}${cubePoly(cx + 2, cy - 1, 0.7, '#e07050')}</g>`;
  fx += `<g class="bx-gull"><polygon points="-108,-72 -102,-70 -96,-73 -102,-68" fill="#ffffff"></polygon></g>`;
  const origin: [number, number] = [300, 118];
  const mainSvg = svgWrap(
    `<ellipse class="shadow" cx="300" cy="228" rx="125" ry="7" fill="#1b2340" fill-opacity="0.1"></ellipse><g transform="translate(${origin.join(' ')})"><g class="float">${main.svg}${fx}</g></g>`,
  );
  const islet = (seed: number, radius: number, u: number) => {
    const mm = new Model();
    island(mm, { rx: radius, ry: radius, seed, depth: radius, rough: 0.25, surf: () => 'lawn' });
    palm(mm, 0, 0, 1, radius > 6 ? 5 : 3, 'sway');
    if (radius > 6) waterfall(mm, 2, radius - 1, 0, -5, 1);
    return layerOf(mm, u).svg;
  };
  const layers = surroundingLayers('beach', islet);
  return {
    layers: {
      far: layers.far,
      clouds: layers.clouds,
      main: mainSvg,
      front: layers.front,
      glow: glowLayer(main, origin, [s(-0.5, 8.5, 4.5), s(5, -4, 3)], 'beach'),
    },
  };
}
export const beachCss = `
.vq .boat { animation: beachBoat 5s ease-in-out infinite; }
@keyframes beachBoat { 0%,100% { transform:translateY(0) } 50% { transform:translateY(1.5px) } }
.vq .bx-walk { animation:beachWalk 34s linear infinite; }
@keyframes beachWalk { 0%,100% { transform:translate(0,0) } 22%,78% { transform:translate(-40px,20px) } 45%,55% { transform:translate(-100px,22px) } }
.vq .bx-crab { animation:beachCrab 11s ease-in-out infinite; }
@keyframes beachCrab { 0%,15%,85%,100% { transform:translate(0,0) } 35%,50% { transform:translate(24px,10px) } 65% { transform:translate(12px,5px) } }
.vq .bx-gull { animation:beachGull 26s ease-in-out infinite; }
@keyframes beachGull { 0%,100% { transform:translate(0,0) } 25% { transform:translate(90px,-14px) } 50% { transform:translate(200px,4px) } 75% { transform:translate(100px,20px) } }
`;
