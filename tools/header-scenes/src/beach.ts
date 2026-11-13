/** Beach, redrawn from the VoxelHeaders and Android Beach boards. */
import { Model, hash3, noise2, island, cubePoly, figure, layerOf, svgWrap } from './kit.ts';
import {
  waterfall,
  waterEffects,
  glowLayer,
  surroundingLayers,
  project as s,
} from './island-details.ts';

/** A leaning trunk under an umbrella of fronds that droop at their tips. */
function palm(
  m: Model,
  x: number,
  y: number,
  z: number,
  height: number,
  group: string,
  lean: [number, number] = [1, 0],
  reach = 4,
) {
  let cx = x,
    cy = y;
  for (let k = 0; k < height; k++) {
    cx = x + Math.round((lean[0] * k * k) / (height * 3));
    cy = y + Math.round((lean[1] * k * k) / (height * 3));
    m.set(cx, cy, z + k, k % 3 === 2 ? 'palmTrunkDark' : 'palmTrunk');
  }
  const top = z + height;
  const leaf = (dx: number, dy: number, dz: number, light = false) =>
    m.set(cx + dx, cy + dy, top + dz, light ? 'palmLight' : 'palm', { g: group });
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) leaf(dx, dy, 0, !dx && !dy);
  leaf(0, 0, 1, true);
  // Coconuts tucked under the crown.
  m.set(cx + 1, cy, top - 1, 'coconut');
  m.set(cx, cy + 1, top - 1, 'coconut');
  const fronds: [number, number, number][] = [
    [1, 0, reach],
    [-1, 0, reach],
    [0, 1, reach],
    [0, -1, reach],
    [1, 1, reach - 1],
    [-1, -1, reach - 1],
    [1, -1, reach - 1],
    [-1, 1, reach - 1],
  ];
  for (const [dx, dy, len] of fronds)
    for (let k = 2; k <= len + 1; k++) {
      const droop = k <= 2 ? 0 : k === 3 ? 0 : k - 3;
      leaf(dx * k, dy * k, -droop, k % 2 === 0);
      if (k >= 3) leaf(dx * k, dy * k, -droop - 1);
      if (k === len + 1) leaf(dx * k, dy * k, -droop - 2);
    }
}
/** A thatched hut raised on a plank deck, with a stepped pyramid roof. */
function hut(m: Model, x0: number, y0: number, z0: number) {
  m.box(x0 - 1, y0 - 1, z0, x0 + 5, y0 + 5, z0, 'plank');
  for (const [px, py] of [
    [x0 - 1, y0 + 5],
    [x0 + 5, y0 + 5],
    [x0 + 5, y0 - 1],
  ])
    m.box(px, py, z0 - 1, px, py, z0, 'timberD');
  m.box(x0, y0, z0 + 1, x0 + 4, y0 + 4, z0 + 4, 'hutWall');
  for (const x of [x0, x0 + 4]) m.set(x, y0 + 4, z0 + 3, 'glass', { win: true });
  m.set(x0 + 4, y0 + 2, z0 + 3, 'glass', { win: true });
  m.set(x0 + 2, y0 + 4, z0 + 1, 'door');
  m.set(x0 + 2, y0 + 4, z0 + 2, 'door');
  m.set(x0 + 2, y0 + 4, z0 + 3, 'door');
  for (let k = 0; k < 4; k++)
    m.box(x0 - 1 + k, y0 - 1 + k, z0 + 5 + k, x0 + 5 - k, y0 + 5 - k, z0 + 5 + k, (x, y) =>
      (x * 3 + y * 5 + k) % 4 ? 'thatch' : 'thatchLight',
    );
}
function sailboat(x0: number, y0: number): Model {
  const boat = new Model();
  const g = { g: 'boat' };
  boat.box(x0, y0, 1, x0 + 6, y0 + 2, 1, 'boatRed', g);
  boat.box(x0 + 1, y0, 2, x0 + 5, y0 + 2, 2, 'white', g);
  boat.set(x0 + 7, y0 + 1, 1, 'boatRed', g);
  for (let z = 3; z <= 11; z++) boat.set(x0 + 3, y0 + 1, z, 'mastWood', g);
  // A tall mainsail behind the mast and a lower jib in front of it.
  for (let z = 3; z <= 10; z++) {
    for (let k = 1; k <= Math.ceil((11 - z) / 3); k++) boat.set(x0 + 3 - k, y0 + 1, z, 'white', g);
    if (z <= 7)
      for (let k = 1; k <= Math.ceil((8 - z) / 2); k++)
        boat.set(x0 + 3 + k, y0 + 1, z, 'sailShade', g);
  }
  return boat;
}

export function beachScene() {
  const m = new Model();
  // Screen axes: u runs across the header, v toward the viewer. The lagoon is a wide oval in them.
  const U = (x: number, y: number) => x - y,
    V = (x: number, y: number) => x + y;
  const disc = (x: number, y: number) =>
    Math.hypot(U(x, y) / 39, V(x, y) / 24) + (noise2(x * 0.2 + 40, y * 0.2 + 40, 60) - 0.5) * 0.1;
  const land = (x: number, y: number) =>
    Math.hypot((U(x, y) + 5) / 27, (V(x, y) + 5) / 13.5) +
    (noise2(x * 0.25, y * 0.25, 62) - 0.5) * 0.26;
  const HILL: [number, number] = [-15, 5];
  const hillAt = (x: number, y: number) => {
    const d =
      Math.hypot((x - HILL[0]) / 6.2, (y - HILL[1]) / 6.2) +
      (noise2(x * 0.5, y * 0.5, 64) - 0.5) * 0.34;
    return d >= 1 ? 0 : Math.round(13 * Math.pow(1 - d, 0.55));
  };
  const isLand = (x: number, y: number) => land(x, y) <= 1;
  for (let x = -34; x <= 34; x++)
    for (let y = -34; y <= 34; y++) {
      const d = disc(x, y);
      if (d > 1) continue;
      const dry = isLand(x, y);
      const top = dry ? 1 + hillAt(x, y) : 0;
      let depth = Math.max(
        5,
        Math.round(15 * Math.pow(1 - d, 0.5) * (0.7 + 0.6 * noise2(x * 0.4 + 9, y * 0.4 + 3, 61))),
      );
      if (hash3(x, y, 0, 65) < 0.07) depth += 1 + Math.floor(hash3(x, y, 1, 66) * 3);
      for (let z = -depth; z <= top; z++) {
        let mat: string;
        if (z === top) {
          if (!dry) mat = hash3(x, y, 0, 66) < 0.1 ? 'seaLight' : 'sea';
          else if (top > 2) mat = hash3(x, y, z, 61) < 0.8 ? 'cliff' : 'cliffRock';
          else {
            const shore = land(x, y) + Math.max(0, V(x, y) + 5) * 0.022;
            mat =
              shore > 0.8
                ? hash3(x, y, 1, 67) < 0.3
                  ? 'beachSandLight'
                  : 'beachSand'
                : noise2(x * 0.3, y * 0.3, 68) < 0.5
                  ? 'lawn'
                  : 'grass';
          }
        } else if (z > 0)
          mat = top > 2 ? (hash3(x, y, z, 62) < 0.4 ? 'cliffMoss' : 'cliffRock') : 'beachSand';
        else if (z >= -2) mat = dry ? 'beachSand' : 'sea';
        else if (z === -3) mat = 'beachSand';
        else if (z === -4) mat = 'dirt';
        else mat = z <= -depth + 1 && depth > 5 ? 'rockD' : 'rock';
        m.set(x, y, z, mat);
      }
    }
  // The waterfall steps down the hill toward the viewer, then a stream crosses the sand to the sea.
  let fallFoot: [number, number, number] = [HILL[0], HILL[1], 2];
  for (const lane of [0, 1]) {
    let x = HILL[0] + lane,
      y = HILL[1] + 1 - lane + 1;
    let z = m.top(x, y) ?? 1;
    while (z > 1) {
      const next = m.top(x + 1, y + 1) ?? 1;
      for (let zz = Math.min(z, next + 1); zz <= z; zz++)
        m.set(x, y, zz, hash3(x, y, zz, 69) < 0.5 ? 'foam' : 'fall');
      x++;
      y++;
      z = next;
    }
    fallFoot = [x, y, 2];
    for (; isLand(x, y) && m.has(x, y, 1); x++, y++)
      m.set(x, y, 1, hash3(x, y, 0, 71) < 0.3 ? 'foam' : 'fall');
    for (let k = 0; k < 3 && m.has(x, y, 0); k++, x++, y++) m.set(x, y, 0, 'seaLight');
  }
  hut(m, 3, -11, 2);
  palm(m, -17, 11, 2, 10, 'sway', [1, 1], 4);
  palm(m, -4, -13, 2, 11, 'sway2', [-1, 0], 3);
  palm(m, 15, -13, 2, 9, 'sway', [1, -1], 3);
  palm(m, -3, -4, 2, 5, 'sway2', [0, 0], 2);
  // The red-and-white parasol with towels beside it.
  m.box(4, -1, 2, 4, -1, 3, 'timberD');
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > 3) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      m.set(
        4 + dx,
        -1 + dy,
        ring < 2 ? 4 : 3,
        Math.floor((Math.atan2(dy, dx) * 4) / Math.PI + 8.5) & 1 ? 'white' : 'boatRed',
      );
    }
  m.set(4, -1, 5, 'boatRed');
  for (const [x, y] of [
    [-1, 2],
    [0, 2],
    [8, -5],
  ] as const)
    if (m.top(x, y) === 1) m.set(x, y, 1, 'towelPink');
  // A short jetty on dark posts from the beach toward the moored boat.
  for (let x = 13; x <= 20; x++) for (const y of [-5, -4]) m.set(x, y, 1, 'plank');
  for (const x of [13, 16, 20]) for (const y of [-6, -3]) m.box(x, y, 0, x, y, 2, 'jettyPost');
  // Boulders on the shore.
  for (const [x, y, w] of [
    [-12, 17, 2],
    [1, 11, 2],
    [13, -19, 2],
    [-8, 15, 1],
  ] as const) {
    m.box(x, y, 1, x + w - 1, y + w - 1, w, 'stone');
    if (w > 1) m.set(x, y + 1, w + 1, 'stone');
  }
  // The lantern: a big glowing cube on a wooden post.
  m.box(-5, 6, 2, -5, 6, 4, 'timberD');
  m.box(-6, 5, 5, -5, 6, 6, 'lamp', { lit: true });
  for (const [x, y] of [
    [-9, 3],
    [-11, -5],
    [0, -5],
    [7, -7],
    [-4, 1],
    [-13, -2],
    [8, 1],
    [-17, 7],
    [-2, -11],
    [5, -3],
    [-9, 10],
  ] as const) {
    const z = m.top(x, y);
    if (z === null || z !== 1 || !isLand(x, y)) continue;
    m.set(x, y, 2, 'leafB');
    m.set(x + 1, y, 2, 'leafA');
    if (hash3(x, y, 0, 70) < 0.5) m.set(x, y, 3, 'leafB');
  }
  // Two more falls spill over the lagoon's rim, front-left and right.
  const rim = (x: number, y: number): [number, number, number] => {
    while (m.has(x + 1, y + 1, 0)) {
      x++;
      y++;
    }
    return [x + 1, y + 1, 0];
  };
  const left = rim(-10, 10),
    right = rim(16, -17);
  for (const [fx0, fy0] of [left, right])
    for (const dx of [0, 1]) for (let z = 0; z >= -10; z--) m.set(fx0 + dx, fy0 - dx, z, 'fall');
  const falls: [number, number, number][] = [fallFoot, left, right];
  for (const v of sailboat(17, -15).v.values()) m.set(v.x, v.y, v.z, v.m, { g: v.g });
  const main = layerOf(m, 4);
  const [vx, vy] = s(10.5, -5.5, 2),
    [cx, cy] = s(-9, 13, 2);
  let fx = waterEffects(m, s, falls, 65);
  fx += `<g class="bx-walk" style="animation-delay: -3s"><g class="wbob">${figure(vx, vy, '#e9e2d0', '#4f6f8f', cubePoly(vx, vy - 9.3, 3.5, '#dcc48d'))}</g></g>`;
  fx += `<g class="bx-crab">${cubePoly(cx, cy, 1.4, '#c9553f')}${cubePoly(cx - 2, cy - 1, 0.7, '#e07050')}${cubePoly(cx + 2, cy - 1, 0.7, '#e07050')}</g>`;
  fx += `<g class="bx-gull"><polygon points="-108,-72 -102,-70 -96,-73 -102,-68" fill="#ffffff"></polygon></g>`;
  const origin: [number, number] = [306, 126];
  const mainSvg = svgWrap(
    `<ellipse class="shadow" cx="300" cy="228" rx="140" ry="7" fill="#1b2340" fill-opacity="0.1"></ellipse><g transform="translate(${origin.join(' ')})"><g class="float">${main.svg}${fx}</g></g>`,
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
      glow: glowLayer(main, origin, [s(-5, 6, 6), s(6, -7, 5)], 'beach'),
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
