// Fine-voxel isometric renderer: a voxel model -> flat, colour-merged SVG paths.
// Hidden surfaces are removed on the isometric triangle lattice, so nothing overdraws.
export type Face = 'top' | 'py' | 'px';
export interface VoxelOptions {
  g?: string;
  win?: boolean;
  lit?: boolean;
}
export interface Voxel extends VoxelOptions {
  x: number;
  y: number;
  z: number;
  m: string;
}
export interface Material {
  c?: string;
  top?: string;
  side?: string;
  j?: number;
  fn?: (voxel: Voxel, face: Face, base: string) => string | null;
}
type Surface = { d: number; v: Voxel; face: Face; half: number };
type Buffer = Map<string, Surface>;
export type Point = [number, number];
export type Project = (x: number, y: number, z: number) => Point;
export interface IslandOptions {
  rx: number;
  ry: number;
  seed?: number;
  depth?: number;
  rough?: number;
  taper?: number;
  hTop?: (x: number, y: number, distance: number) => number;
  surf?: (x: number, y: number, z: number, distance: number) => string;
  sub?: (x: number, y: number, z: number, top: number) => string;
}
export const imul = Math.imul;
export function hash3(x: number, y: number, z: number, s = 0) {
  let h =
    imul(x | 0, 374761393) ^
    imul(y | 0, 668265263) ^
    imul(z | 0, 1442695041) ^
    imul(s | 0, 1274126177);
  h = imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sm = (t: number) => t * t * (3 - 2 * t);
export function noise2(x: number, y: number, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi;
  const h = (i: number, j: number) => hash3(i, j, 17, seed);
  return lerp(
    lerp(h(xi, yi), h(xi + 1, yi), sm(xf)),
    lerp(h(xi, yi + 1), h(xi + 1, yi + 1), sm(xf)),
    sm(yf),
  );
}
export const shade = (hex: string, f: number) =>
  '#' +
  [1, 3, 5]
    .map((i) =>
      Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
export const mix = (a: string, b: string, t: number) =>
  '#' +
  [1, 3, 5]
    .map((i) =>
      Math.round(lerp(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), t))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const n = (v: number) => +v.toFixed(2);

export class Model {
  v = new Map<string, Voxel>();
  key(x: number, y: number, z: number) {
    return x + ',' + y + ',' + z;
  }
  set(x: number, y: number, z: number, m: string, o?: VoxelOptions) {
    this.v.set(this.key(x, y, z), { x, y, z, m, ...(o || {}) });
  }
  get(x: number, y: number, z: number) {
    return this.v.get(this.key(x, y, z));
  }
  has(x: number, y: number, z: number) {
    return this.v.has(this.key(x, y, z));
  }
  del(x: number, y: number, z: number) {
    this.v.delete(this.key(x, y, z));
  }
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    m: string | ((x: number, y: number, z: number) => string),
    o?: VoxelOptions,
  ) {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          this.set(x, y, z, typeof m === 'function' ? m(x, y, z) : m, o);
  }
  top(x: number, y: number) {
    let t = null;
    for (let z = 40; z >= -30; z--)
      if (this.has(x, y, z)) {
        t = z;
        break;
      }
    return t;
  }
}

export function makeRenderer(MAT: Record<string, Material>) {
  function faceColor(v: Voxel, face: Face) {
    const M = MAT[v.m];
    if (!M) throw new Error('no material ' + v.m);
    let base = face === 'top' ? (M.top ?? M.c) : (M.side ?? M.c);
    if (!base) throw new Error('no colour for material ' + v.m);
    if (M.fn) base = M.fn(v, face, base) ?? base;
    const f = face === 'top' ? 1 : face === 'py' ? 0.88 : 0.76;
    const j = 1 + (Math.floor(hash3(v.x, v.y, v.z, 3) * 3) - 1) * (M.j ?? 0.02);
    return shade(base, f * j);
  }
  // Each cube face covers two triangles of the lattice. Keys: "col,row,L|R".
  function tris(v: Voxel): [string, Face, number][] {
    const i0 = v.x - v.y,
      r0 = v.x + v.y - 2 * v.z;
    return [
      [i0 - 1 + ',' + (r0 - 2) + ',R', 'top', 0],
      [i0 + ',' + (r0 - 2) + ',L', 'top', 1],
      [i0 - 1 + ',' + (r0 - 1) + ',L', 'py', 0],
      [i0 - 1 + ',' + r0 + ',R', 'py', 1],
      [i0 + ',' + r0 + ',L', 'px', 0],
      [i0 + ',' + (r0 - 1) + ',R', 'px', 1],
    ];
  }
  function zbuffer(voxels: Voxel[]): Buffer {
    const buf: Buffer = new Map();
    for (const v of voxels) {
      const d = v.x + v.y + v.z;
      for (const [key, face, half] of tris(v)) {
        const e = buf.get(key);
        if (!e || d > e.d) buf.set(key, { d, v, face, half });
      }
    }
    return buf;
  }
  function paths(
    buf: Buffer,
    u: number,
    pred?: (v: Voxel, face: Face) => boolean,
    colorOf = faceColor,
  ) {
    const h = u / 2;
    const faces = new Map<string, { v: Voxel; face: Face; halves: [number, string][] }>();
    for (const [key, e] of buf) {
      if (pred && !pred(e.v, e.face)) continue;
      const id = e.v.x + ',' + e.v.y + ',' + e.v.z + ',' + e.face;
      let f = faces.get(id);
      if (!f) faces.set(id, (f = { v: e.v, face: e.face, halves: [] }));
      f.halves.push([e.half, key]);
    }
    const byColor = new Map<string, string[]>();
    const add = (c: string, d: string) => {
      const a = byColor.get(c);
      if (a) a.push(d);
      else byColor.set(c, [d]);
    };
    for (const f of faces.values()) {
      const c = colorOf(f.v, f.face);
      const i0 = f.v.x - f.v.y,
        r0 = f.v.x + f.v.y - 2 * f.v.z;
      if (f.halves.length === 2) {
        if (f.face === 'top')
          add(c, `M${n((i0 - 1) * u)} ${n((r0 - 1) * h)}l${u} ${-h}l${u} ${h}l${-u} ${h}z`);
        else if (f.face === 'py')
          add(c, `M${n((i0 - 1) * u)} ${n((r0 - 1) * h)}l${u} ${h}v${u}l${-u} ${-h}z`);
        else add(c, `M${n(i0 * u)} ${n(r0 * h)}l${u} ${-h}v${u}l${-u} ${h}z`);
      } else {
        const [col, row, t] = f.halves[0][1].split(',');
        const cc = +col,
          rr = +row;
        if (t === 'L') add(c, `M${n(cc * u)} ${n(rr * h)}v${u}l${u} ${-h}z`);
        else add(c, `M${n((cc + 1) * u)} ${n(rr * h)}v${u}l${-u} ${-h}z`);
      }
    }
    return [...byColor.keys()]
      .sort()
      .map((c) => `<path fill="${c}" d="${byColor.get(c)!.join('')}"></path>`)
      .join('');
  }
  // Static voxels, each animated group, night windows and lit cubes as separate path sets.
  function render(model: Model, u: number) {
    const all = [...model.v.values()];
    const bufAll = zbuffer(all);
    // One visibility solution for every layer; a moving leaf still hides the stone behind it.
    const bufStatic: Buffer = new Map([...bufAll].filter(([, e]) => !e.v.g));
    const groups: Record<string, string> = {};
    for (const g of new Set(all.flatMap((v) => (v.g ? [v.g] : []))))
      groups[g] = paths(bufAll, u, (v) => v.g === g);
    return {
      coverage: {
        base: [...bufStatic.keys()],
        groups: Object.fromEntries(
          Object.keys(groups).map((g) => [
            g,
            [...bufAll].filter(([, e]) => e.v.g === g).map(([key]) => key),
          ]),
        ),
      },
      base: paths(bufStatic, u),
      groups,
      wins: paths(
        bufAll,
        u,
        (v, face) => !!v.win && face !== 'top',
        // Keep the actual night colour in portable data, rather than a web-only CSS override.
        () => '#ffd98a',
      ),
      lit: paths(
        bufAll,
        u,
        (v) => !!v.lit,
        (v, face) => (face === 'top' ? '#fff6d8' : face === 'py' ? '#ffdc8c' : '#f6c968'),
      ),
      visible: (x: number, y: number, z: number) => {
        const v = model.get(x, y, z);
        if (!v) return false;
        return tris(v).some(([k]) => bufAll.get(k)?.v === v);
      },
      bounds: () => {
        let a = 1e9,
          b = -1e9,
          c = 1e9,
          d = -1e9;
        for (const k of bufAll.keys()) {
          const [col, row] = k.split(',').map(Number);
          a = Math.min(a, col * u);
          b = Math.max(b, (col + 1) * u);
          c = Math.min(c, (row * u) / 2);
          d = Math.max(d, ((row + 2) * u) / 2);
        }
        return [a, b, c, d];
      },
    };
  }
  return { render, faceColor };
}
// Screen position of a model point for voxel size u.
export const S =
  (u: number): Project =>
  (x, y, z) => [n((x - y) * u), n(((x + y) * u) / 2 - z * u)];
// A small free-standing cube as three polygons (for walkers, smoke, flakes).
export function cubePoly(cx: number, cy: number, s: number, c: string, f = [1, 0.88, 0.76]) {
  const h = s / 2;
  return (
    `<polygon points="${n(cx)},${n(cy - h)} ${n(cx + s)},${n(cy)} ${n(cx)},${n(cy + h)} ${n(cx - s)},${n(cy)}" fill="${shade(c, f[0])}"></polygon>` +
    `<polygon points="${n(cx - s)},${n(cy)} ${n(cx)},${n(cy + h)} ${n(cx)},${n(cy + h + s)} ${n(cx - s)},${n(cy + s)}" fill="${shade(c, f[1])}"></polygon>` +
    `<polygon points="${n(cx)},${n(cy + h)} ${n(cx + s)},${n(cy)} ${n(cx + s)},${n(cy + s)} ${n(cx)},${n(cy + h + s)}" fill="${shade(c, f[2])}"></polygon>`
  );
}
// Organic floating island: noisy ellipse, soil under the surface, rock tapering to hanging tips.
export function island(m: Model, o: IslandOptions) {
  const { rx, ry, seed = 1, depth = 10 } = o;
  for (let x = -rx - 3; x <= rx + 3; x++)
    for (let y = -ry - 3; y <= ry + 3; y++) {
      const d =
        Math.hypot(x / rx, y / ry) +
        (noise2(x * 0.2 + 40, y * 0.2 + 40, seed) - 0.5) * (o.rough ?? 0.3);
      if (d > 1) continue;
      const top = o.hTop ? o.hTop(x, y, d) : 0;
      const edge = 1 - d;
      let dep = Math.max(
        1,
        Math.round(
          depth *
            Math.pow(edge, o.taper ?? 0.6) *
            (0.7 + 0.6 * noise2(x * 0.4 + 9, y * 0.4 + 3, seed + 1)),
        ),
      );
      if (hash3(x, y, 0, seed + 5) < 0.07) dep += 1 + Math.floor(hash3(x, y, 1, seed + 6) * 3);
      const bottom = -dep;
      for (let z = bottom; z <= top; z++) {
        let mat;
        if (z === top) mat = o.surf ? o.surf(x, y, z, d) : 'grass';
        else if (z >= top - 2 && z >= bottom + 1) mat = o.sub ? o.sub(x, y, z, top) : 'dirt';
        else mat = z <= bottom + 1 && dep > 3 ? 'rockD' : 'rock';
        m.set(x, y, z, mat);
      }
    }
}
export function cloud(m: Model, rx: number, ry: number, seed: number, layers = 3) {
  for (let l = 0; l < layers; l++) {
    const k = 1 - l * 0.28;
    for (let x = -rx; x <= rx; x++)
      for (let y = -ry; y <= ry; y++) {
        const d =
          Math.hypot((x - l) / (rx * k), (y + l * 0.5) / (ry * k)) +
          (noise2(x * 0.45, y * 0.45, seed + l) - 0.5) * 0.5;
        if (d <= 1) m.set(x, y, l, 'cloud');
      }
  }
}
