/** Sakura, redrawn from the web and Android Sakura boards. */
import { Model, hash3, noise2, island, cubePoly, figure, layerOf, svgWrap } from './kit.ts';
import {
  waterEffects,
  lamp,
  glowLayer,
  surroundingLayers,
  project as s,
} from './island-details.ts';

/** A lumpy cloud of blossom on a dark forked trunk, never a ball. */
function cherry(
  m: Model,
  x: number,
  y: number,
  z: number,
  height: number,
  radius: number,
  group: string,
) {
  const wide = radius >= 5;
  m.box(x, y, z, x + (wide ? 1 : 0), y + (wide ? 1 : 0), z + height, 'cherryTrunk');
  if (wide) {
    m.box(x - 1, y, z + height - 1, x - 1, y, z + height + 1, 'cherryTrunk');
    m.box(x + 2, y + 1, z + height - 2, x + 2, y + 1, z + height, 'cherryTrunk');
  }
  const lobes = wide ? 14 : radius >= 3 ? 6 : 4;
  const r = wide ? 3.3 : radius >= 3 ? 2.4 : 1.7;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + hash3(x, y, i, 90) * 0.9;
    const reach = i === 0 ? 0 : radius * (0.35 + hash3(x, i, y, 91) * 0.5);
    const cx = x + Math.cos(a) * reach,
      cy = y + Math.sin(a) * reach,
      cz = z + height + 1 + hash3(i, x, y, 92) * (wide ? 2.6 : 1.5);
    for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++)
      for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++)
        for (let zz = Math.floor(cz - r * 0.7); zz <= Math.ceil(cz + r * 0.7); zz++) {
          if (zz < z + height - 1) continue;
          if (
            Math.hypot((xx - cx) / r, (yy - cy) / r, (zz - cz) / (r * 0.72)) >
            1 - hash3(xx, yy, zz, 93) * 0.22
          )
            continue;
          const h = hash3(xx, yy, zz, 78);
          m.set(
            xx,
            yy,
            zz,
            h < 0.5
              ? 'cherryPink'
              : h < 0.72
                ? 'cherryRose'
                : h < 0.86
                  ? 'cherryDeep'
                  : 'cherryLight',
            { g: group },
          );
        }
  }
}
/** Two storeys on a stone base: white walls, red timber, blue-grey roofs with turned-up corners. */
function pagoda(m: Model, x: number, y: number) {
  m.box(x - 6, y - 6, 1, x + 6, y + 6, 1, 'gardenStone');
  const walls = (radius: number, bottom: number, top: number) => {
    m.box(x - radius, y - radius, bottom, x + radius, y + radius, top, 'pagodaWall');
    for (let k = -radius; k <= radius; k++) {
      const post = Math.abs(k) === radius || k === 0;
      for (let z = bottom; z <= top; z++) {
        if (post) {
          m.set(x + k, y + radius, z, 'pagodaRed');
          m.set(x + radius, y + k, z, 'pagodaRed');
        } else if (z > bottom) {
          m.set(x + k, y + radius, z, 'pagodaWall', { win: true });
          m.set(x + radius, y + k, z, 'pagodaWall', { win: true });
        }
      }
    }
  };
  const roof = (radius: number, bottom: number, tiers: number) => {
    for (let k = 0; k < tiers; k++)
      m.box(
        x - radius + k,
        y - radius + k,
        bottom + k,
        x + radius - k,
        y + radius - k,
        bottom + k,
        'pagodaRoof',
      );
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      m.set(x + dx * radius, y + dy * radius, bottom, 'pagodaEave');
      m.set(x + dx * radius, y + dy * radius, bottom + 1, 'pagodaEave');
    }
  };
  walls(4, 2, 5);
  m.set(x, y + 4, 2, 'door');
  m.set(x, y + 4, 3, 'door');
  roof(5, 6, 2);
  walls(3, 8, 10);
  roof(4, 11, 2);
  m.box(x - 1, y - 1, 13, x + 1, y + 1, 13, 'pagodaRoof');
  m.box(x, y, 14, x, y, 15, 'finial');
}
function torii(m: Model, x: number, y0: number, y1: number) {
  for (const y of [y0, y1]) {
    m.box(x, y, 1, x, y, 9, 'toriiRed');
    m.set(x, y, 1, 'pagodaEave');
  }
  m.box(x, y0 - 1, 7, x, y1 + 1, 7, 'toriiRed');
  m.box(x, y0 - 2, 10, x, y1 + 2, 10, 'toriiRed');
  m.box(x, y0 - 3, 11, x, y1 + 3, 11, 'pagodaEave');
  m.set(x, y0 - 3, 12, 'pagodaEave');
  m.set(x, y1 + 3, 12, 'pagodaEave');
  m.set(x, (y0 + y1) / 2, 8, 'toriiRed');
  m.set(x, (y0 + y1) / 2, 9, 'toriiRed');
}
function shrub(m: Model, x: number, y: number) {
  m.set(x, y, 1, 'cherryTrunk');
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = 0; dz <= 2; dz++)
        if (Math.abs(dx) + Math.abs(dy) + (dz === 1 ? 0 : 1) <= 2)
          m.set(x + dx, y + dy, 2 + dz, 'shrubDark');
}
export function sakuraScene() {
  const m = new Model();
  const U = (x: number, y: number) => x - y,
    V = (x: number, y: number) => x + y;
  const disc = (x: number, y: number) =>
    Math.hypot(U(x, y) / 38, V(x, y) / 25) + (noise2(x * 0.2 + 40, y * 0.2 + 40, 76) - 0.5) * 0.16;
  const pond = (x: number, y: number) =>
    Math.hypot((x + 5) / 6.4, (y - 8) / 5) + (noise2(x * 0.45, y * 0.45, 79) - 0.5) * 0.4;
  const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax,
      dy = by - ay,
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const path = (x: number, y: number) =>
    seg(x, y, -3, -3, 6, -6) <= 1.3 ||
    seg(x, y, 6, -6, 13, -13) <= 1.4 ||
    seg(x, y, 13, -13, 22, -15) <= 1.4;
  const stream = (x: number, y: number) => x - y >= -17 && x - y <= -16 && V(x, y) > 6;
  const CHERRIES: [number, number, number, number][] = [
    [-17, 0, 6, 8],
    [9, 2, 4, 3],
    [17, -19, 4, 3],
    [-25, 11, 2, 2],
  ];
  for (let x = -36; x <= 36; x++)
    for (let y = -36; y <= 36; y++) {
      const d = disc(x, y);
      if (d > 1) continue;
      let depth = Math.max(
        2,
        Math.round(11 * Math.pow(1 - d, 0.7) * (0.7 + 0.6 * noise2(x * 0.4 + 9, y * 0.4 + 3, 77))),
      );
      if (hash3(x, y, 0, 81) < 0.07) depth += 1 + Math.floor(hash3(x, y, 1, 82) * 3);
      for (let z = -depth; z < 0; z++)
        m.set(x, y, z, z >= -2 ? 'dirt' : z <= -depth + 1 && depth > 4 ? 'rockD' : 'rock');
      let top: string;
      const p = pond(x, y);
      if (p < 1 || stream(x, y)) top = 'water';
      else if (p < 1.25 && hash3(x, y, 0, 83) < 0.45) top = 'stone';
      else if (path(x, y)) top = (x + y) % 2 ? 'gardenStone' : 'gardenStoneLight';
      else {
        const near = Math.min(
          ...CHERRIES.map(([cx, cy, , r]) => Math.hypot(x - cx, y - cy) / (r + 5)),
        );
        const h = hash3(x, y, 0, 80);
        top =
          near < 1 && h < 0.3 * (1.15 - near)
            ? h < 0.07
              ? 'petalLight'
              : 'petal'
            : noise2(x * 0.3, y * 0.3, 77) < 0.5
              ? 'sakuraGrass'
              : 'sakuraGrassLight';
      }
      m.set(x, y, 0, top);
    }
  pagoda(m, -3, -11);
  torii(m, 13, -17, -9);
  cherry(m, CHERRIES[0][0], CHERRIES[0][1], 1, 5, 8, 'sway');
  cherry(m, CHERRIES[1][0], CHERRIES[1][1], 1, 4, 3, 'sway2');
  cherry(m, CHERRIES[2][0], CHERRIES[2][1], 1, 4, 3, 'sway');
  cherry(m, CHERRIES[3][0], CHERRIES[3][1], 1, 2, 2, 'sway2');
  // Bamboo behind the torii: jointed stalks of different heights with leafy side shoots.
  for (const [x, y, h] of [
    [6, -23, 9],
    [8, -24, 12],
    [10, -23, 10],
    [5, -21, 7],
    [9, -21, 13],
    [11, -25, 8],
    [7, -26, 11],
    [12, -22, 11],
    [4, -24, 10],
    [13, -24, 7],
  ] as const) {
    if (!m.has(x, y, 0)) continue;
    for (let z = 1; z <= h; z++) m.set(x, y, z, z % 3 ? 'bamboo' : 'bambooDark');
    for (let z = Math.max(4, h - 5); z <= h; z += 2) {
      const side = (z + x) % 2 ? 1 : -1;
      m.set(x + side, y, z, 'bamboo', { g: 'sway2' });
      m.set(x, y + side, z + 1, 'bambooDark', { g: 'sway2' });
    }
    m.set(x, y, h + 1, 'bamboo', { g: 'sway2' });
  }
  // The red bridge crosses the stream just before it falls off the front-left edge.
  for (let x = -5; x <= 1; x++)
    for (const y of [15, 16]) {
      const z = x > -4 && x < 0 ? 2 : 1;
      m.set(x, y, z, 'toriiRed');
      if (x === -5 || x === 1 || x === -2)
        m.set(x, y === 15 ? 15 : 16, z + (y === 15 ? 1 : 0), y === 15 ? 'bridgeRed' : 'toriiRed');
    }
  let edge: [number, number] = [-3, 13];
  for (let t = 0; t < 30; t++) if (m.has(-3 + t, 13 + t, 0)) edge = [-3 + t, 13 + t];
  for (const dx of [0, 1])
    for (let z = 0; z >= -10; z--)
      m.set(edge[0] + 1 + dx, edge[1] + 1 - dx + (dx ? 1 : 0), z, 'fall');
  lamp(m, 5, -5, 1);
  lamp(m, 11, 9, 1);
  for (const [x, y] of [
    [-22, 14],
    [6, 14],
    [20, -4],
    [-12, 19],
    [-27, 5],
    [14, 6],
  ] as const)
    if (m.has(x, y, 0)) shrub(m, x, y);
  for (const [x, y] of [
    [-12, 5],
    [-11, 4],
    [-12, 4],
    [-18, 12],
    [1, 5],
    [2, 6],
  ] as const)
    m.set(x, y, 1, 'stone');
  m.set(-12, 4, 2, 'stone');
  const main = layerOf(m, 4);
  let fx = waterEffects(m, s, [[edge[0] + 1, edge[1] + 1, 0]], 83);
  const [px, py] = s(-6, 8, 1);
  fx += `<g class="koi">${cubePoly(px, py, 1.1, '#f6efe4')}${cubePoly(px + 1.5, py, 0.8, '#e88743')}</g><g class="koi koi2">${cubePoly(px - 10, py + 4, 1.1, '#f6efe4')}${cubePoly(px - 8.5, py + 4, 0.8, '#e88743')}</g>`;
  const [wx, wy] = s(-2.5, -5.5, 1),
    [fx0, fy0] = s(3.5, 10.5, 1);
  fx += `<g class="walker" style="animation-delay: -3s"><g class="wbob">${figure(wx, wy, '#6877a8', '#55628f', cubePoly(wx, wy - 9.3, 3.5, '#dcc48d'))}</g></g>`;
  fx += `<g class="fox"><g class="wbob">${cubePoly(fx0, fy0 - 1, 2.3, '#d98a4f')}${cubePoly(fx0 + 3.5, fy0 - 2.6, 1.7, '#d98a4f')}${cubePoly(fx0 + 4.6, fy0 - 1.2, 0.9, '#f6efe4')}${cubePoly(fx0 - 4, fy0 - 2, 1.6, '#d98a4f')}${cubePoly(fx0 - 5.7, fy0 - 3.5, 1, '#f6efe4')}${cubePoly(fx0 + 3, fy0 - 5, 0.8, '#8b4936')}</g></g>`;
  for (let k = 0; k < 16; k++) {
    const [px, py] = s(-22 + hash3(k, 1, 0, 84) * 14, -4 + hash3(k, 2, 0, 85) * 14, 12);
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
      glow: glowLayer(main, origin, [s(5.5, -4.5, 2.5), s(11.5, 9.5, 2.5)], 'sakura'),
    },
  };
}
export const sakuraCss = `
.vq .walker { animation:sakuraWalk 30s linear infinite; }
@keyframes sakuraWalk { 0%,100% { transform:translate(0,0) } 45%,55% { transform:translate(84px,-6px) } }
.vq .fox { animation:sakuraFox 18s ease-in-out infinite; }
@keyframes sakuraFox { 0%,10%,90%,100% { transform:translate(0,0) } 40%,60% { transform:translate(36px,18px) } }
.vq .pt { opacity:0; animation:sakuraPetal 7s linear infinite; }
.vq .pt2 { animation-name:sakuraPetal2; }
@keyframes sakuraPetal { 0% { transform:translate(0,0);opacity:0 } 10%,85% { opacity:1 } 50% { transform:translate(10px,22px) } 100% { transform:translate(14px,46px);opacity:0 } }
@keyframes sakuraPetal2 { 0% { transform:translate(0,0);opacity:0 } 10%,85% { opacity:1 } 45% { transform:translate(-3px,18px) } 100% { transform:translate(8px,42px);opacity:0 } }
`;
