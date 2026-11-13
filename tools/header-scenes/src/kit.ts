import type { Voxel, VoxelOptions, Project } from './engine.ts';
import { Model, makeRenderer, hash3, noise2, shade, S, cubePoly, island, cloud } from './engine.ts';
export { Model, hash3, noise2, shade, S, cubePoly, island, cloud };

const pickBy = (v: Voxel, list: string[], seed = 9) =>
  list[Math.floor(hash3(v.x, v.y, v.z, seed) * list.length)];
export const MAT: Record<string, import('./engine.ts').Material> = {
  grass: { top: '#8ab46d', side: '#7ea564' },
  lawn: { top: '#9cc47c', side: '#86ad6a' },
  meadow: {
    top: '#8ab46d',
    side: '#7ea564',
    fn: (v, f) =>
      f === 'top'
        ? pickBy(v, [
            '#8ab46d',
            '#8ab46d',
            '#8ab46d',
            '#93bb74',
            '#f0d98c',
            '#f3f0e4',
            '#e6a9bb',
            '#8ab46d',
          ])
        : null,
  },
  alp: {
    top: '#8fae7a',
    side: '#7f9c6d',
    fn: (v, f) =>
      f === 'top' ? pickBy(v, ['#8fae7a', '#8fae7a', '#88a674', '#98b583', '#a3ab7a']) : null,
  },
  dirt: { c: '#7c614b' },
  rock: { c: '#8b8883', j: 0.03 },
  rockD: { c: '#5d5a57', j: 0.03 },
  stone: { c: '#a39f96', j: 0.03 },
  sand: { c: '#e3d5b3' },
  snow: { top: '#f6f8f9', side: '#d5dde3', j: 0.01 },
  water: {
    top: '#8cc3cf',
    side: '#74aebb',
    fn: (v, f) => (f === 'top' ? pickBy(v, ['#8cc3cf', '#8cc3cf', '#96cbd6', '#84bcc9']) : null),
    j: 0,
  },
  fall: { top: '#d5edf1', side: '#b9dde5', j: 0.015 },
  pave: { c: '#d2cdc0' },
  gravel: { c: '#cbbf9f' },
  bike: { top: '#8dbfae', side: '#7aa998' },
  path: { top: '#bfae8c', side: '#a39374' },
  plank: { c: '#b98f63', fn: (v, f, b) => ((v.x + v.y) % 2 ? b : '#ad8358') },
  timber: { c: '#c99c69' },
  timberD: { c: '#a87d53' },
  log: { c: '#8a6547' },
  door: { c: '#5e4533' },
  conc: { c: '#ebe6da' },
  conc2: { c: '#d8d4cb' },
  white: { c: '#f3f1ea' },
  sage: { c: '#c7d5bf' },
  clay: { c: '#dcb99c' },
  sky: { c: '#bcd2de' },
  glass: { c: '#8aa5b6', j: 0.015 },
  glassL: { top: '#cfe9ea', side: '#b3d9db', j: 0.015 },
  frame: { c: '#f5f3ed' },
  solar: {
    top: '#3d5a80',
    side: '#314a6c',
    fn: (v, f) => (f === 'top' && (v.x + v.y) % 2 ? '#4a6b96' : null),
    j: 0.01,
  },
  sedum: {
    top: '#93bd78',
    side: '#7ea86a',
    fn: (v, f) =>
      f === 'top' ? pickBy(v, ['#93bd78', '#93bd78', '#a6c888', '#84b274', '#c1c98a']) : null,
  },
  roofFlat: { c: '#c9c5bb' },
  mast: { c: '#f0f2f3', j: 0.01 },
  iron: { c: '#3d424b' },
  lamp: { c: '#ffd27a', j: 0 },
  fire: { c: '#ff9d45', j: 0 },
  soil: { c: '#7a5c44' },
  crop: { top: '#86bb62', side: '#6fa353', j: 0.05 },
  trunk: { c: '#7a5a43' },
  leafA: { c: '#5f9a55', j: 0.06 },
  leafB: { c: '#73b062', j: 0.06 },
  leafC: { c: '#4f8a52', j: 0.06 },
  leafY: { c: '#b5c765', j: 0.05 },
  leafO: { c: '#dba85a', j: 0.05 },
  leafP: { c: '#e9b7c6', j: 0.04 },
  pine: { c: '#4f7d5c', j: 0.06 },
  pineD: { c: '#3f6a4e', j: 0.06 },
  roofR: { c: '#a9473c' },
  roofB: { c: '#4b627c' },
  roofG: { c: '#4f7459' },
  roofK: { c: '#454a53' },
  roofBr: { c: '#7d553b' },
  roofT: { c: '#bd6d52' },
  red: { c: '#c9553f' },
  yel: { c: '#e3b94f' },
  blu: { c: '#5a86b8' },
  flagB: { c: '#4f78c4', j: 0 },
  flagW: { c: '#f1f1ee', j: 0 },
  flagR: { c: '#d04b3e', j: 0 },
  flagG: { c: '#4f9a5b', j: 0 },
  flagY: { c: '#e8c14a', j: 0 },
  cloud: { top: '#ffffff', side: '#e4e9ee', j: 0.015 },
};
export const R = makeRenderer(MAT);

export function roundTree(
  m: Model,
  x: number,
  y: number,
  z: number,
  { th = 3, r = 2, mat = 'leafA', g }: { th?: number; r?: number; mat?: string; g?: string } = {},
) {
  for (let i = 0; i < th; i++) m.set(x, y, z + i, 'trunk');
  const cz = z + th + r - 1;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dy, dz * 1.2);
        if (d <= r + 0.35 - hash3(x + dx, y + dy, cz + dz, 21) * 0.6)
          m.set(x + dx, y + dy, cz + dz, mat, g ? { g } : undefined);
      }
}
export function pine(
  m: Model,
  x: number,
  y: number,
  z: number,
  {
    h = 7,
    snow = false,
    mat = 'pine',
    g,
  }: { h?: number; snow?: boolean; mat?: string; g?: string } = {},
) {
  m.set(x, y, z, 'trunk');
  if (h > 6) m.set(x, y, z + 1, 'trunk');
  const start = z + (h > 6 ? 2 : 1),
    tiers = h - (h > 6 ? 2 : 1);
  for (let t = 0; t < tiers; t++) {
    const r = t >= tiers - 2 ? 0 : t >= tiers - 4 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > r + (r === 2 && t % 2 === 0 ? 1 : 0)) continue;
        const tip = t === tiers - 1;
        const edge = Math.abs(dx) + Math.abs(dy) >= r && r > 0;
        const sn = snow && (tip || (edge && hash3(x + dx, y + dy, t, 5) < 0.2));
        m.set(x + dx, y + dy, start + t, sn ? 'snow' : mat, g ? { g } : undefined);
      }
  }
}
// A-frame cabin. axis 'y': ridge runs along y, glazed gable faces +y. axis 'x': gable faces +x.
export function aframe(
  m: Model,
  {
    x0,
    y0,
    w,
    d,
    z0,
    axis = 'y',
    roof = 'roofR',
    wall = 'timber',
    snow = 0,
    chimney = false,
  }: {
    x0: number;
    y0: number;
    w: number;
    d: number;
    z0: number;
    axis?: 'x' | 'y';
    roof?: string;
    wall?: string;
    snow?: number;
    chimney?: boolean;
  },
) {
  const mid = (w - 1) / 2;
  const put = (i: number, j: number, z: number, mat: string, o?: VoxelOptions) =>
    axis === 'y' ? m.set(x0 + i, y0 + j, z, mat, o) : m.set(x0 + j, y0 + i, z, mat, o);
  for (let i = 0; i < w; i++) {
    const hc = 2 * Math.min(i, w - 1 - i) + 2,
      di = Math.abs(i - mid);
    for (let j = 0; j < d; j++)
      for (let k = 0; k < hc; k++) {
        const shell = k >= hc - 2;
        if (!shell && j !== d - 1) continue;
        let mat = wall,
          o;
        if (shell)
          mat =
            snow && k === hc - 1 && hash3(i, j, k, 77) < (di === 0 ? snow * 1.7 : snow * 0.3)
              ? 'snow'
              : roof;
        else if (di === 0 && k <= 1) mat = 'door';
        else if (hc >= 6 && k >= (di === 0 ? 3 : 1) && k <= hc - 3) {
          mat = 'glass';
          o = { win: true };
        }
        put(i, j, z0 + k, mat, o);
      }
  }
  if (chimney) {
    const i = mid + 2,
      hc = 2 * Math.min(i, w - 1 - i) + 2;
    for (let k = 0; k < 3; k++) put(i, 1, z0 + hc + k, 'stone');
  }
  const top = (i: number, j: number): [number, number, number] => {
    const hc = 2 * Math.min(i, w - 1 - i) + 2;
    return axis === 'y' ? [x0 + i, y0 + j, z0 + hc] : [x0 + j, y0 + i, z0 + hc];
  };
  return {
    chimneyTop: chimney
      ? (() => {
          const [x, y, z] = top(mid + 2, 1);
          return [x, y, z + 3];
        })()
      : null,
    door: axis === 'y' ? [x0 + mid, y0 + d, z0] : [x0 + d, y0 + mid, z0],
  };
}
// Tiny person out of three cubes, feet at screen (sx, sy).
export function figure(sx: number, sy: number, shirt: string, pants: string, extra = '') {
  return (
    cubePoly(sx, sy - 2.6, 2.4, pants) +
    cubePoly(sx, sy - 5.2, 2.6, shirt) +
    cubePoly(sx, sy - 7.8, 2.3, '#e9c9ad') +
    extra
  );
}
export const vx = (paths: string, cls = '') =>
  paths ? `<g class="vx${cls ? ' ' + cls : ''}">${paths}</g>` : '';
export function layerOf(model: Model, u: number) {
  const r = R.render(model, u);
  return {
    r,
    svg:
      vx(r.base) +
      Object.entries(r.groups)
        .map(([g, p]) => vx(p, g))
        .join(''),
  };
}
export const diamond = (s: Project, x: number, y: number, z: number) => {
  const a = s(x, y, z + 1),
    b = s(x + 1, y, z + 1),
    c = s(x + 1, y + 1, z + 1),
    d = s(x, y + 1, z + 1);
  return `${d[0]},${d[1]} ${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]}`;
};
export const svgWrap = (inner: string, cls = 'vq-art') =>
  `<svg class="${cls}" viewBox="0 0 1100 240" preserveAspectRatio="xMinYMid slice" aria-hidden="true">${inner}</svg>`;
export function cloudSvg(rx: number, ry: number, seed: number, u = 3, layers = 3) {
  const m = new Model();
  cloud(m, rx, ry, seed, layers);
  return vx(R.render(m, u).base);
}
export const BIRDS =
  '<g class="birds"><polygon points="-2,70 3,69 5,70 3,71" fill="#ffffff"></polygon><polygon class="wing wa" points="0,70 2,65 4,66 3,70" fill="#f1f4f7"></polygon><polygon class="wing wb" points="0,70 2,74 4,73 3,70" fill="#e6eaee"></polygon><polygon points="5,70 7,69.4 7,70.6" fill="#3a3d45"></polygon><polygon points="-16,76 -11,75 -9,76 -11,77" fill="#ffffff"></polygon><polygon class="wing wa" points="-14,76 -12,71 -10,72 -11,76" fill="#f1f4f7"></polygon><polygon class="wing wb" points="-14,76 -12,80 -10,79 -11,76" fill="#e6eaee"></polygon><polygon points="-9,76 -7,75.4 -7,76.6" fill="#3a3d45"></polygon></g>';

export const glowDefs = (id: string) =>
  `<defs><radialGradient id="${id}-glow"><stop offset="0" stop-color="#ffd27a" stop-opacity="0.85"></stop><stop offset="0.35" stop-color="#ffc35c" stop-opacity="0.35"></stop><stop offset="1" stop-color="#ffb347" stop-opacity="0"></stop></radialGradient></defs>`;
