import type { IslandOptions } from './engine.ts';
import {
  Model,
  S,
  hash3,
  noise2,
  island,
  pine,
  aframe,
  figure,
  cubePoly,
  vx,
  layerOf,
  diamond,
  svgWrap,
  cloudSvg,
  BIRDS,
  glowDefs,
} from './kit.ts';

export function alpScene() {
  const u = 4,
    s = S(u),
    m = new Model();
  const inRect = (x: number, y: number, a: number, b: number, c: number, d: number) =>
    x >= a && x <= c && y >= b && y <= d;
  const peak = (x: number, y: number) =>
    15 * Math.max(0, 1 - Math.hypot(x + 10, y + 11) / 17) ** 1.25;
  const shoulder = (x: number, y: number) =>
    8 * Math.max(0, 1 - Math.hypot(x - 9, y + 13) / 11) ** 1.2;
  const raw = (x: number, y: number) =>
    Math.max(peak(x, y), shoulder(x, y)) +
    (noise2(x * 0.3, y * 0.3, 7) - 0.5) * 1.8 +
    Math.max(0, Math.min(1.5, -(x + y) / 14));
  const PADS = [
    [-5, 4, 5, 14, 1],
    [7, -10, 16, -2, 3],
    [-20, 5, -12, 14, 1],
    [10, 2, 18, 10, 1],
    [-13, -3, -8, 3, 5],
    [-2, 15, 4, 19, 0],
  ];
  const CLEAR = [
    [-6, 13, 6, 23],
    [-22, 12, -11, 22],
    [16, -11, 24, 11],
    [-13, 3, -7, 6],
  ];
  const padAt = (x: number, y: number) => PADS.find(([a, b, c, d]) => inRect(x, y, a, b, c, d));
  const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax,
      dy = by - ay,
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const near = (pts: number[][], x: number, y: number) => {
    let d = 99;
    for (let i = 0; i + 1 < pts.length; i++)
      d = Math.min(d, seg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
    return d;
  };
  const STREAM = [
    [-5, -8],
    [-6, -2],
    [-6, 5],
    [-7, 11],
    [-8, 17],
    [-8, 30],
  ];
  const PATHS = [
    [
      [1, 23],
      [1, 15],
    ],
    [
      [-3, 15],
      [-9, 14],
      [-16, 15],
    ],
    [
      [4, 16],
      [11, 12],
      [17, 10],
    ],
    [
      [17, 2],
      [17, -2],
      [16, -3],
    ],
    [
      [-12, 14],
      [-11, 8],
      [-10, 4],
    ],
  ];
  const onStream = (x: number, y: number) =>
    !padAt(x, y) && near(STREAM, x, y) <= (y > 6 ? 1.0 : 0.75);
  const onPath = (x: number, y: number) =>
    PATHS.some((p) => near(p, x, y) <= 0.75) || Math.hypot(x - 1, y - 17) <= 2.8;
  const H = (x: number, y: number) => {
    const p = padAt(x, y);
    if (p) return p[4];
    let h = Math.max(0, Math.min(18, Math.round(raw(x, y))));
    if (onStream(x, y)) h = Math.max(0, h - 1);
    return h;
  };
  const steep = (x: number, y: number) =>
    Math.max(Math.abs(H(x, y) - H(x + 1, y)), Math.abs(H(x, y) - H(x, y + 1))) >= 2;
  const surf = (x: number, y: number, z: number) => {
    if (onStream(x, y)) return 'water';
    if (onPath(x, y) && z <= 7) return 'path';
    const nz = noise2(x * 0.35, y * 0.35, 3);
    if (z >= 12 - nz * 2.5) return 'snow';
    if (z >= 8) return nz > 0.55 ? 'snow' : 'rock';
    if (z >= 5 || steep(x, y)) return nz > 0.7 ? 'snow' : steep(x, y) || z >= 6 ? 'rock' : 'alp';
    return hash3(x, y, 0, 15) < 0.05 ? 'snow' : 'alp';
  };
  island(m, {
    rx: 24,
    ry: 24,
    seed: 23,
    depth: 13,
    taper: 0.8,
    hTop: H,
    surf,
    sub: (x, y, z, top) => (top >= 5 ? 'rock' : 'dirt'),
  });

  const cabins = [
    aframe(m, {
      x0: -4,
      y0: 5,
      w: 9,
      d: 8,
      z0: 2,
      axis: 'y',
      roof: 'roofR',
      snow: 0.3,
      chimney: true,
    }),
    aframe(m, {
      x0: 8,
      y0: -9,
      w: 7,
      d: 7,
      z0: 4,
      axis: 'x',
      roof: 'roofB',
      snow: 0.5,
      chimney: true,
    }),
    aframe(m, { x0: -19, y0: 6, w: 7, d: 7, z0: 2, axis: 'y', roof: 'roofG', snow: 0.25 }),
    aframe(m, {
      x0: 11,
      y0: 3,
      w: 7,
      d: 6,
      z0: 2,
      axis: 'x',
      roof: 'roofK',
      snow: 0.2,
      chimney: true,
    }),
    aframe(m, { x0: -12, y0: -2, w: 5, d: 5, z0: 6, axis: 'y', roof: 'roofBr', snow: 0.7 }),
  ];
  // decks, posts and lanterns
  const halos = [];
  const lantern = (x: number, y: number, z: number) => {
    m.set(x, y, z, 'timberD');
    m.set(x, y, z + 1, 'lamp', { lit: true });
    halos.push(s(x + 0.5, y + 0.5, z + 1.5));
  };
  const deck = (a: number, b: number, c: number, d: number, z: number) => {
    for (let x = a; x <= c; x++)
      for (let y = b; y <= d; y++) if (m.has(x, y, z)) m.set(x, y, z, 'plank');
  };
  deck(-3, 13, 3, 14, 1);
  for (const x of [-3, 3]) for (let z = 2; z <= 4; z++) m.set(x, 14, z, 'timberD');
  m.set(3, 14, 5, 'lamp', { lit: true });
  halos.push(s(3.5, 14.5, 5.5));
  ['flagB', 'flagW', 'flagR', 'flagG', 'flagY'].forEach((f, i) =>
    m.set(-2 + i, 14, i === 2 ? 3 : 4, f),
  );
  deck(15, -8, 16, -4, 3);
  lantern(16, -4, 4);
  deck(-18, 13, -14, 14, 1);
  lantern(-14, 14, 2);
  deck(17, 4, 18, 8, 1);
  lantern(17, 8, 2);
  deck(-11, 3, -9, 3, 5);
  // wood piles, benches, campfire in the square
  for (const [x, y, z] of [
    [5, 6, 2],
    [5, 7, 2],
    [5, 6, 3],
    [-12, 8, 2],
    [-12, 9, 2],
    [12, 10, 2],
    [13, 10, 2],
  ])
    if (m.has(x, y, z - 1)) m.set(x, y, z, 'log');
  m.set(1, 17, 1, 'log');
  m.set(1, 17, 2, 'fire', { lit: true });
  const fire = s(1.5, 17.5, 2.5);
  for (const [x, y] of [
    [-1, 17],
    [3, 18],
    [1, 19],
  ])
    m.set(x, y, 1, 'log');
  // bridge where the path meets the stream
  for (let x = -10; x <= -5; x++) for (const y of [14, 15]) m.set(x, y, 2, 'plank');
  for (const x of [-10, -5])
    for (const y of [13, 16])
      if (m.top(x, y) !== null) m.set(x, y, Math.max(m.top(x, y)! + 1, 2), 'timberD');
  // pines and boulders
  const blocked = (x: number, y: number) =>
    padAt(x, y) ||
    onStream(x, y) ||
    onPath(x, y) ||
    near(STREAM, x, y) < 2 ||
    PATHS.some((p) => near(p, x, y) < 1.8) ||
    CLEAR.some(([a, b, c, d]) => inRect(x, y, a, b, c, d));
  let np = 0;
  for (let x = -23; x <= 23; x++)
    for (let y = -23; y <= 23; y++) {
      const z = m.top(x, y);
      if (z === null || blocked(x, y) || m.get(x, y, z)!.m === 'plank') continue;
      const hsh = hash3(x, y, 0, 91);
      if (Math.hypot(x, y) > 21.5) continue;
      if (hsh < 0.062 && z <= 9 && !m.has(x, y, z + 1)) {
        let ok = true;
        for (let dx = -2; dx <= 2 && ok; dx++)
          for (let dy = -2; dy <= 2 && ok; dy++)
            if (
              (dx || dy) &&
              m.get(x + dx, y + dy, m.top(x + dx, y + dy) ?? 0)?.m?.startsWith('pine') &&
              Math.abs(dx) + Math.abs(dy) < 3
            )
              ok = false;
        if (!ok) continue;
        const g = np % 6 === 0 ? 'sway' : np % 6 === 3 ? 'sway2' : undefined;
        np++;
        pine(m, x, y, z + 1, {
          h: 5 + Math.floor(hash3(x, y, 1, 92) * 4),
          snow: z >= 4 || hash3(x, y, 2, 93) < 0.4,
          mat: hash3(x, y, 3, 94) < 0.5 ? 'pine' : 'pineD',
          g,
        });
      } else if (hsh > 0.975 && !m.has(x, y, z + 1)) {
        m.set(x, y, z + 1, 'rock');
        if (hash3(x, y, 4, 95) < 0.5 && m.has(x + 1, y, m.top(x + 1, y) ?? -99))
          m.set(x + 1, y, z + 1, 'rock');
      }
    }
  // waterfall off the front-left edge
  const falls = [];
  for (const x of [-8, -9]) {
    let ye = 16;
    while (m.has(x, ye + 1, m.top(x, ye + 1) ?? -99) && ye < 30) ye++;
    const zt = m.top(x, ye) ?? 0;
    falls.push([x, ye + 1, zt]);
    for (let z = zt; z >= zt - 12; z--) m.set(x, ye + 1, z, 'fall');
  }

  const main = layerOf(m, u);
  let fx = '';
  const waters = [...m.v.values()].filter((v) => v.m === 'water' && !m.has(v.x, v.y, v.z + 1));
  waters
    .filter((v) => hash3(v.x, v.y, 0, 71) < 0.22)
    .forEach((v, i) => {
      fx += `<polygon class="${i % 2 ? 'shim' : 'shim2'}" points="${diamond(s, v.x, v.y, v.z)}" fill="#eef8fa" style="animation-delay: -${(i * 0.6).toFixed(1)}s"></polygon>`;
    });
  waters
    .filter((v) => v.y >= 8 && hash3(v.x, v.y, 0, 72) < 0.3)
    .forEach((v, i) => {
      fx += `<polygon class="flow" points="${diamond(s, v.x, v.y, v.z)}" fill="#f2fafb" style="animation-delay: -${(i * 0.4).toFixed(1)}s"></polygon>`;
    });
  falls.forEach(([fxx, fyy, zt], c) => {
    for (let k = 0; k < 5; k++) {
      const [ax, ay] = s(fxx, fyy + 1, zt - k * 2.4);
      fx += `<polygon class="drop" style="animation-delay: -${(k * 0.27 + c * 0.17).toFixed(2)}s" points="${ax},${ay} ${ax + 4},${ay + 2} ${ax + 4},${ay + 6} ${ax},${ay + 4}" fill="#ffffff"></polygon>`;
    }
  });
  const [mx0, my0] = s(falls[0][0], falls[0][1] + 1, falls[0][2] - 13);
  for (let k = 0; k < 3; k++)
    fx += `<g class="mist" style="animation-delay: -${(k * 0.9).toFixed(1)}s">${cubePoly(mx0 - 3 + k * 4, my0 + (k % 2) * 2, 2.4, '#ffffff', [1, 0.96, 0.92])}</g>`;
  // chimney smoke
  cabins
    .filter((c) => c.chimneyTop)
    .forEach((c, ci) => {
      const [x, y, z] = c.chimneyTop!;
      const [px, py] = s(x + 0.5, y + 0.5, z);
      for (let k = 0; k < 3; k++)
        fx += `<g class="mvsmk" style="animation-delay: -${(k * 1.5 + ci * 0.6).toFixed(1)}s">${cubePoly(px, py - 3, 2.6 + k * 0.3, '#f3f3f1', [1, 0.95, 0.9])}</g>`;
    });
  // a hiker on the path, someone by the fire, snow in the air
  const [hx, hy] = s(1.5, 22.5, 1),
    [sx, sy] = s(2.6, 16.4, 1);
  fx += `<g class="mvhike"><g class="wbob">${figure(hx, hy, '#d9694f', '#4b567e', cubePoly(hx - 2.6, hy - 5.2, 1.8, '#5c7a52'))}</g></g>`;
  fx += figure(sx, sy, '#4f78c4', '#3d4a66');
  for (let i = 0; i < 14; i++) {
    const x = Math.round(-150 + hash3(i, 1, 0, 51) * 290),
      y = Math.round(-110 + hash3(i, 2, 0, 52) * 110);
    fx += `<rect class="mvsnow${i % 2 ? ' mvsnow2' : ''}" x="${x}" y="${y}" width="1.6" height="1.6" fill="#ffffff" style="animation-delay: -${(hash3(i, 3, 0, 53) * 8).toFixed(1)}s"></rect>`;
  }
  const ORG = [300, 126];
  const [bx0, bx1, by0, by1] = main.r.bounds();
  const mainSvg = svgWrap(
    `<ellipse class="shadow" cx="${ORG[0]}" cy="233" rx="124" ry="6" fill="#1b2340" fill-opacity="0.1"></ellipse><g transform="translate(${ORG[0]} ${ORG[1]})"><g class="float">${main.svg}${fx}</g></g>`,
  );
  const doorA = s(0.5, 13, 6);
  const glow = svgWrap(
    `<g transform="translate(${ORG[0]} ${ORG[1]})"><g class="float">${vx(main.r.wins, 'wins')}<circle class="halo" cx="${fire[0]}" cy="${fire[1]}" r="24" fill="url(#mv-glow)"></circle>${halos
      .slice(0, 3)
      .map(
        (h) =>
          `<circle class="halo halo2" cx="${h[0]}" cy="${h[1]}" r="15" fill="url(#mv-glow)"></circle>`,
      )
      .join(
        '',
      )}<circle class="door-glow" cx="${doorA[0]}" cy="${doorA[1]}" r="22" fill="url(#mv-glow)"></circle>${vx(main.r.lit, 'lit')}</g></g>`,
    'vq-art vq-glow',
  );

  const islet = (
    uu: number,
    seed: number,
    rx: number,
    ry: number,
    opt: Partial<IslandOptions>,
    deco: (model: Model) => void,
  ) => {
    const mm = new Model();
    island(mm, { rx, ry, seed, depth: Math.max(4, rx * 0.9), rough: 0.35, ...opt });
    deco(mm);
    return layerOf(mm, uu).svg;
  };
  const hill = (cx: number, cy: number, hh: number, r: number) => (x: number, y: number) =>
    Math.max(0, Math.round(hh * Math.max(0, 1 - Math.hypot(x - cx, y - cy) / r)));
  const snowy = (x: number, y: number, z: number) => (z >= 3 ? 'snow' : z >= 2 ? 'rock' : 'alp');
  const far1 = islet(2, 3, 8, 8, { hTop: hill(-3, -3, 7, 7), surf: snowy }, (mm) => {
    aframe(mm, { x0: 1, y0: 1, w: 5, d: 4, z0: (mm.top(3, 3) ?? 0) + 1, roof: 'roofR', snow: 0.4 });
    pine(mm, -4, 4, (mm.top(-4, 4) ?? 0) + 1, { h: 6, snow: true, g: 'sway' });
    pine(mm, 5, -3, (mm.top(5, -3) ?? 0) + 1, { h: 5, snow: true });
  });
  const far2 = islet(2, 5, 6, 6, { hTop: hill(0, -1, 3, 5), surf: snowy }, (mm) => {
    pine(mm, 0, 1, (mm.top(0, 1) ?? 0) + 1, { h: 7, snow: true, g: 'sway' });
    pine(mm, 3, 2, (mm.top(3, 2) ?? 0) + 1, { h: 5 });
  });
  const far3 = islet(2, 8, 4, 4, { surf: () => 'snow' }, (mm) => {
    pine(mm, 0, 0, 1, { h: 5, snow: true });
  });
  const far = svgWrap(
    `<g transform="translate(650 64)"><g class="float3">${far1}</g></g><g transform="translate(150 96)"><g class="float2">${far2}</g></g><g transform="translate(596 182)"><g class="float3">${far3}</g></g><g class="cf"><g transform="translate(420 38)">${cloudSvg(9, 5, 4, 2, 2)}</g></g><g class="cf cf2"><g transform="translate(180 22)">${cloudSvg(7, 4, 6, 2, 2)}</g></g>${BIRDS}`,
  );
  const clouds = svgWrap(
    `${glowDefs('mv')}<g class="cl c1"><g transform="translate(90 40)">${cloudSvg(9, 5, 31)}</g></g><g class="cl c2"><g transform="translate(520 150)">${cloudSvg(8, 4, 32)}</g></g><g class="cl c3"><g transform="translate(330 26)">${cloudSvg(7, 4, 33)}</g></g>`,
  );
  const frontIslet = islet(
    6,
    14,
    5,
    4,
    { surf: (x: number, y: number) => (hash3(x, y, 0, 3) < 0.45 ? 'snow' : 'alp') },
    (mm) => {
      pine(mm, 0, 0, 1, { h: 8, snow: true, g: 'sway' });
      mm.set(2, 2, 1, 'rock');
      mm.set(3, 2, 1, 'rock');
      mm.set(-2, 2, 1, 'log');
    },
  );
  const front = svgWrap(
    `<g transform="translate(46 212)"><g class="float2">${frontIslet}</g></g><g class="wisp"><g transform="translate(250 214)">${cloudSvg(10, 5, 41, 3, 2)}</g></g><g class="wisp wisp2"><g transform="translate(520 224)">${cloudSvg(8, 4, 42, 3, 2)}</g></g>`,
  );
  return {
    layers: { far, clouds, main: mainSvg, front, glow },
    stats: {
      voxels: m.v.size,
      pines: np,
      bounds: [bx0 + ORG[0], bx1 + ORG[0], by0 + ORG[1], by1 + ORG[1]],
    },
  };
}
export const alpCss = `
.vq .mvsmk { opacity: 0; animation: mvsmk 4.5s ease-out infinite; }
@keyframes mvsmk { 0% { transform: translate(0, 0) scale(0.7); opacity: 0 } 15% { opacity: 0.85 } 100% { transform: translate(9px, -22px) scale(1.5); opacity: 0 } }
.vq .mvsmk polygon { transform-box: fill-box; }
.vq .mvhike { animation: mvhike 26s linear infinite; }
@keyframes mvhike { 0%, 4% { transform: translate(0, 0) } 44%, 58% { transform: translate(24px, -12px) } 96%, 100% { transform: translate(0, 0) } }
.vq .mvsnow { opacity: 0; animation: mvsnow 9s linear infinite; }
.vq .mvsnow2 { animation-duration: 12s; }
@keyframes mvsnow { 0% { transform: translate(0, 0); opacity: 0 } 10% { opacity: 0.9 } 80% { opacity: 0.9 } 100% { transform: translate(-10px, 70px); opacity: 0 } }
`;
