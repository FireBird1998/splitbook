/** Sakura, redrawn from the web and Android Sakura boards. */
import { Model, hash3, noise2, island, cubePoly, figure, layerOf, svgWrap } from './kit.ts';
import {
  waterfall,
  waterEffects,
  lamp,
  glowLayer,
  surroundingLayers,
  project as s,
} from './island-details.ts';

/** Broad, interlocking cloud-like blossom clusters, rather than a spherical tree. */
function cherry(
  m: Model,
  x: number,
  y: number,
  z: number,
  height: number,
  radius: number,
  group: string,
) {
  m.box(x, y, z, x + 1, y + 1, z + height, 'cherryTrunk');
  const lobes =
    radius >= 5
      ? [
          [-4, -1, 1],
          [0, -4, 4],
          [4, -2, 0],
          [-3, 3, 0],
          [1, 1, 2],
          [4, 3, 0],
          [0, 4, 1],
          [-4, -4, 2],
        ]
      : [
          [-2, 0, 0],
          [2, 0, 1],
          [0, -2, 2],
          [0, 2, 0],
          [0, 0, 3],
        ];
  for (const [dx, dy, dz] of lobes) {
    const r = radius >= 5 ? 2 : Math.max(1, Math.round(radius * 0.6));
    for (let xx = -r; xx <= r; xx++)
      for (let yy = -r; yy <= r; yy++)
        for (let zz = -1; zz <= 1; zz++) {
          if (Math.hypot(xx / (r + 0.5), yy / (r + 0.5), zz / 2.5) > 1.2) continue;
          m.set(
            x + dx + xx,
            y + dy + yy,
            z + height + dz + zz,
            hash3(x + xx, y + yy, z + zz, 78) < 0.7
              ? 'cherryPink'
              : hash3(x + xx, y + yy, z + zz, 78) < 0.85
                ? 'cherryLight'
                : 'cherryRose',
            { g: group },
          );
        }
  }
}
function pagoda(m: Model) {
  const x = -4,
    y = -12;
  m.box(x - 5, y - 5, 1, x + 5, y + 5, 1, 'stone');
  const walls = (radius: number, bottom: number, top: number) => {
    m.box(x - radius, y - radius, bottom, x + radius, y + radius, top, 'pagodaWall');
    for (const xx of [x - radius, x, x + radius])
      for (const yy of [y - radius, y + radius]) m.box(xx, yy, bottom, xx, yy, top, 'pagodaTimber');
    for (const yy of [y - radius, y, y + radius])
      m.box(x + radius, yy, bottom, x + radius, yy, top, 'pagodaTimber');
    for (const zz of [bottom + 1, bottom + 2]) {
      m.set(x - 2, y + radius, zz, 'glass', { win: true });
      m.set(x + 2, y + radius, zz, 'glass', { win: true });
      m.set(x + radius, y - 1, zz, 'glass', { win: true });
    }
  };
  const roof = (radius: number, bottom: number) => {
    for (let k = 0; k < 2; k++)
      m.box(
        x - radius + k,
        y - radius + k,
        bottom + k,
        x + radius - k,
        y + radius - k,
        bottom + k,
        k ? 'pagodaRoof' : 'pagodaEave',
      );
  };
  walls(4, 2, 6);
  roof(6, 7);
  walls(3, 9, 12);
  roof(4, 13);
  m.set(x, y, 15, 'finial');
  m.set(x, y, 16, 'finial');
}
function torii(m: Model) {
  for (const y of [-14, 0]) {
    m.box(17, y, 1, 17, y, 10, 'toriiRed');
    m.set(17, y, 1, 'pagodaEave');
  }
  m.box(17, -16, 8, 17, 2, 8, 'toriiRed');
  m.box(17, -17, 11, 17, 3, 11, 'pagodaEave');
  m.box(17, -15, 10, 17, 1, 10, 'toriiRed');
  m.set(17, -17, 12, 'pagodaEave');
  m.set(17, 3, 12, 'pagodaEave');
}
export function sakuraScene() {
  const m = new Model();
  const pond = (x: number, y: number) => Math.hypot((x - 1) / 7, (y - 15) / 5);
  const path = (x: number, y: number) =>
    (Math.abs(y - 3) <= 1 && x >= -9 && x <= 18) || (Math.abs(x - 17) <= 1 && y >= -13 && y <= 13);
  island(m, {
    rx: 27,
    ry: 25,
    seed: 76,
    depth: 9,
    taper: 0.75,
    rough: 0.15,
    surf: (x, y) =>
      pond(x, y) < 1
        ? 'water'
        : pond(x, y) < 1.2
          ? 'stone'
          : path(x, y)
            ? 'gardenStone'
            : noise2(x * 0.3, y * 0.3, 77) < 0.5
              ? 'sakuraGrass'
              : 'sakuraGrassLight',
  });
  pagoda(m);
  torii(m);
  cherry(m, -19, 0, 1, 7, 5, 'sway');
  cherry(m, 18, -12, 1, 5, 2, 'sway2');
  cherry(m, 21, 9, 1, 5, 3, 'sway');
  // Pale bamboo behind the torii, with jointed stalks and a blocky leafy crown.
  for (const [x, y, h] of [
    [15, -18, 10],
    [18, -16, 12],
    [21, -12, 9],
    [14, -16, 8],
  ]) {
    for (let z = 1; z <= h; z++) m.set(x, y, z, z % 3 ? 'bamboo' : 'bambooDark');
    for (let k = -2; k <= 2; k++) m.set(x + k, y, h - Math.abs(k), 'bamboo', { g: 'sway2' });
  }
  // Petal-speckled ground, with most petals close to each cherry canopy.
  for (let x = -28; x <= 28; x++)
    for (let y = -26; y <= 26; y++) {
      if (!m.has(x, y, 0) || m.has(x, y, 1) || path(x, y) || pond(x, y) < 1.3) continue;
      const nearby = Math.min(
        Math.hypot(x + 19, y + 1),
        Math.hypot(x - 21, y - 9),
        Math.hypot(x - 18, y + 12),
      );
      if (nearby < 11 && hash3(x, y, 0, 80) < 0.1)
        m.set(x, y, 0, hash3(x, y, 1, 81) < 0.25 ? 'cherryLight' : 'cherryPink');
    }
  // Red low-arched bridge across the pond's front bank.
  for (let x = -3; x <= 5; x++)
    for (const y of [20, 21]) {
      const z = Math.abs(x - 1) < 3 ? 2 : 1;
      m.set(x, y, z, 'toriiRed');
      if (x % 3 === 1 || x === -3 || x === 5) m.set(x, y, z + 1, 'bridgeRed');
    }
  for (let y = 19; y <= 26; y++) for (const x of [1, 2]) m.set(x, y, 0, 'fall');
  waterfall(m, 1, 26, 0, -9);
  m.set(7, -11, 1, 'stone');
  lamp(m, 7, -11, 2);
  lamp(m, 5, 18, 1);
  for (const [x, y] of [
    [-21, 15],
    [-15, 7],
    [10, 20],
    [24, 5],
    [-26, 4],
  ]) {
    m.set(x, y, 1, 'cherryTrunk');
    m.box(x - 1, y - 1, 2, x + 1, y + 1, 3, 'gardenShrub');
  }
  for (const [x, y] of [
    [-17, 8],
    [-15, 8],
    [-23, 13],
    [3, 5],
  ])
    m.set(x, y, 1, 'stone');
  const main = layerOf(m, 4);
  let fx = waterEffects(m, s, [[1, 26, 0]], 83);
  const [px, py] = s(0, 15, 1);
  fx += `<g class="koi">${cubePoly(px, py, 1.1, '#f6efe4')}${cubePoly(px + 1.5, py, 0.8, '#e88743')}</g><g class="koi koi2">${cubePoly(px - 10, py + 4, 1.1, '#f6efe4')}${cubePoly(px - 8.5, py + 4, 0.8, '#e88743')}</g>`;
  const [wx, wy] = s(-9, 3, 1),
    [fx0, fy0] = s(6.5, 11.5, 1);
  fx += `<g class="walker" style="animation-delay: -3s"><g class="wbob">${figure(wx, wy, '#6877a8', '#55628f', cubePoly(wx, wy - 9.3, 3.5, '#dcc48d'))}</g></g>`;
  fx += `<g class="fox"><g class="wbob">${cubePoly(fx0, fy0 - 1, 2.3, '#d98a4f')}${cubePoly(fx0 + 3.5, fy0 - 2.6, 1.7, '#d98a4f')}${cubePoly(fx0 + 4.6, fy0 - 1.2, 0.9, '#f6efe4')}${cubePoly(fx0 - 4, fy0 - 2, 1.6, '#d98a4f')}${cubePoly(fx0 - 5.7, fy0 - 3.5, 1, '#f6efe4')}${cubePoly(fx0 + 3, fy0 - 5, 0.8, '#8b4936')}</g></g>`;
  for (let k = 0; k < 16; k++) {
    const [px, py] = s(-22 + hash3(k, 1, 0, 84) * 14, -8 + hash3(k, 2, 0, 85) * 17, 12);
    fx += `<g class="pt${k % 2 ? ' pt2' : ''}" style="animation-delay: -${(hash3(k, 3, 0, 86) * 7).toFixed(1)}s">${cubePoly(px, py, 1.2, '#fbe9ee')}</g>`;
  }
  const origin: [number, number] = [300, 116];
  const mainSvg = svgWrap(
    `<ellipse class="shadow" cx="300" cy="228" rx="140" ry="7" fill="#1b2340" fill-opacity="0.1"></ellipse><g transform="translate(${origin.join(' ')})"><g class="float">${main.svg}${fx}</g></g>`,
  );
  const islet = (seed: number, radius: number, u: number) => {
    const mm = new Model();
    island(mm, {
      rx: radius,
      ry: radius,
      seed,
      depth: radius,
      rough: 0.25,
      surf: () => 'sakuraGrass',
    });
    cherry(mm, 0, 0, 1, radius > 6 ? 5 : 3, radius > 6 ? 2 : 1, 'sway');
    return layerOf(mm, u).svg;
  };
  const layers = surroundingLayers('sakura', islet);
  return {
    layers: {
      far: layers.far,
      clouds: layers.clouds,
      main: mainSvg,
      front: layers.front,
      glow: glowLayer(main, origin, [s(7.5, -10.5, 3.5), s(5.5, 18.5, 2.5)], 'sakura'),
    },
  };
}
export const sakuraCss = `
.vq .walker { animation:sakuraWalk 30s linear infinite; }
@keyframes sakuraWalk { 0%,100% { transform:translate(0,0) } 45%,55% { transform:translate(76px,38px) } }
.vq .fox { animation:sakuraFox 18s ease-in-out infinite; }
@keyframes sakuraFox { 0%,10%,90%,100% { transform:translate(0,0) } 40%,60% { transform:translate(36px,18px) } }
.vq .pt { opacity:0; animation:sakuraPetal 7s linear infinite; }
.vq .pt2 { animation-name:sakuraPetal2; }
@keyframes sakuraPetal { 0% { transform:translate(0,0);opacity:0 } 10%,85% { opacity:1 } 50% { transform:translate(10px,22px) } 100% { transform:translate(14px,46px);opacity:0 } }
@keyframes sakuraPetal2 { 0% { transform:translate(0,0);opacity:0 } 10%,85% { opacity:1 } 45% { transform:translate(-3px,18px) } 100% { transform:translate(8px,42px);opacity:0 } }
`;
