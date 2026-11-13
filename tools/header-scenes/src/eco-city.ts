import {
  Model,
  S,
  hash3,
  noise2,
  island,
  roundTree,
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

export function ecoScene() {
  const u = 4,
    s = S(u),
    m = new Model();
  const RX = 24,
    RY = 24;
  const pondD = (x: number, y: number) =>
    Math.hypot((x + 12) / 5.6, (y - 7) / 4.0) + (noise2(x * 0.5, y * 0.5, 31) - 0.5) * 0.3;
  const onStream = (x: number, y: number) => (x === -12 || x === -13) && y >= 10;
  const swale = (x: number, y: number) => inRect(x, y, 13, 7, 18, 8);
  const knoll = (x: number, y: number) =>
    Math.max(0, Math.round(2.6 - Math.hypot(x + 18, y - 1) / 2.1));
  const inRect = (x: number, y: number, a: number, b: number, c: number, d: number) =>
    x >= a && x <= c && y >= b && y <= d;
  const plots = (x: number, y: number) => inRect(x, y, 3, 15, 10, 19);
  const surf = (x: number, y: number) => {
    const pd = pondD(x, y);
    if (pd < 1 || onStream(x, y) || swale(x, y)) return 'water';
    if (pd < 1.22) return 'sand';
    if (inRect(x, y, -1, -1, 1, 21) || inRect(x, y, -7, -1, 3, 1) || inRect(x, y, 2, 4, 21, 5))
      return 'pave';
    if ((x === 2 && y >= 6 && y <= 21) || (y === 6 && x >= 3 && x <= 19)) return 'bike';
    if (pd < 1.62 && pd >= 1.36) return 'gravel';
    if (inRect(x, y, -20, 15, -2, 15) || inRect(x, y, 2, 13, 11, 14)) return 'gravel';
    if (plots(x, y)) return y % 2 ? 'soil' : 'gravel';
    if (inRect(x, y, 4, -5, 19, -3))
      return (x % 4 === 1 || x % 4 === 2) && y !== -4 ? 'soil' : 'lawn';
    if (x < -2 && y > 1) return noise2(x * 0.3, y * 0.3, 5) > 0.58 ? 'meadow' : 'lawn';
    const nz = noise2(x * 0.22 + 3, y * 0.22 + 8, 9);
    return nz > 0.64 ? 'meadow' : nz < 0.4 ? 'lawn' : 'grass';
  };
  island(m, {
    rx: RX,
    ry: RY,
    seed: 11,
    depth: 14,
    taper: 0.85,
    hTop: (x: number, y: number) => (pondD(x, y) < 1.3 || onStream(x, y) ? 0 : knoll(x, y)),
    surf,
  });
  const ground = (x: number, y: number) => m.top(x, y);
  const free = new Set();
  const block = (a: number, b: number, c: number, d: number) => {
    for (let x = a; x <= c; x++) for (let y = b; y <= d; y++) free.add(x + ',' + y);
  };

  // --- towers with planted balconies ---
  function tower(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    h: number,
    { wall = 'conc', roof = 'green', planters = 0.6, step = 3 } = {},
  ) {
    block(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    for (let z = 1; z <= h; z++)
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const fy = y === y1,
            fx = x === x1;
          if (!fy && !fx && z < h) continue;
          let mat = wall,
            o;
          const a = fy ? x - x0 : y - y0;
          if ((fy || fx) && a % 2 === 1 && z >= 2 && z % step !== 1 && z < h) {
            mat = 'glass';
            o = { win: true };
          }
          if (z === 1 && fy && x === x0 + 2) mat = 'door';
          m.set(x, y, z, mat, o);
        }
    for (let z = step + 1; z < h; z += step) {
      for (let x = x0; x <= x1; x++)
        if (hash3(x, z, y1, 41) < planters)
          m.set(x, y1 + 1, z, hash3(x, z, 1, 42) < 0.3 ? 'leafY' : 'leafB');
      for (let y = y0; y <= y1; y++)
        if (hash3(y, z, x1, 43) < planters)
          m.set(x1 + 1, y, z, hash3(y, z, 2, 44) < 0.3 ? 'leafA' : 'leafC');
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const rim = x === x0 || x === x1 || y === y0 || y === y1;
        if (roof === 'green') m.set(x, y, h + 1, rim ? wall : 'sedum');
        else m.set(x, y, h + 1, rim ? wall : (y - y0) % 2 ? 'solar' : 'roofFlat');
      }
    if (roof === 'green') {
      roundTree(m, x0 + 1, y0 + 1, h + 2, { th: 1, r: 1, mat: 'leafB' });
      m.set(x1 - 1, y1 - 1, h + 2, 'leafC');
      m.set(x1 - 1, y0 + 1, h + 2, 'leafY');
    }
  }
  tower(-14, -14, -10, -10, 10, { wall: 'conc', roof: 'green' });
  tower(-7, -15, -3, -11, 8, { wall: 'timber', roof: 'solar', planters: 0.45 });
  tower(-15, -7, -11, -3, 7, { wall: 'sage', roof: 'green', planters: 0.7 });
  tower(-7, -8, -3, -4, 5, { wall: 'clay', roof: 'solar', planters: 0.5, step: 2 });
  // sky-bridge with a planted deck between two towers
  for (let x = -9; x <= -8; x++) {
    m.set(x, -13, 6, 'timberD');
    m.set(x, -13, 7, 'leafB');
  }

  // --- eco row houses: mono-pitch roofs with solar or sedum, facing the sun ---
  function rowHouse(
    x0: number,
    y0: number,
    { w = 4, d = 5, wall = 'white', roof = 'solar', tall = 3 } = {},
  ) {
    const y1 = y0 + d - 1,
      x1 = x0 + w - 1;
    block(x0, y0 - 1, x1, y1 + 1);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const hh = tall + Math.floor((y1 - y) / 2);
        for (let z = 1; z <= hh; z++) {
          let mat = wall,
            o;
          if (y === y1 && z === 2 && (x === x0 + 1 || x === x0 + 2)) {
            mat = 'glass';
            o = { win: true };
          }
          if (y === y1 && z === 1 && x === x0 + 2) mat = 'door';
          if (x === x1 && z === 2 && (y - y0) % 2 === 1) {
            mat = 'glass';
            o = { win: true };
          }
          if (x === x1 && z === 4 && y === y0 + 1) {
            mat = 'glass';
            o = { win: true };
          }
          m.set(x, y, z, mat, o);
        }
        m.set(x, y, hh + 1, x === x0 && w > 3 ? 'timberD' : roof);
      }
    m.set(x0 + 1, y1 + 1, 1, 'leafB');
    m.set(x1, y1 + 1, 1, hash3(x0, y0, 0, 3) < 0.5 ? 'leafY' : 'leafP');
  }
  [
    ['white', 'solar'],
    ['timber', 'sedum'],
    ['sage', 'solar'],
    ['clay', 'sedum'],
  ].forEach(([wall, roof], i) => rowHouse(4 + i * 4, -11, { wall, roof }));
  [
    ['timber', 'solar'],
    ['white', 'sedum'],
    ['sky', 'solar'],
  ].forEach(([wall, roof], i) => rowHouse(8 + i * 4, -2, { wall, roof, d: 4, tall: 2 }));
  for (let x = 5; x <= 18; x++)
    if (surf(x, -5) === 'soil' && hash3(x, -5, 0, 8) < 0.8) m.set(x, -5, 1, 'crop');
  for (let x = 5; x <= 18; x++)
    if (surf(x, -3) === 'soil' && hash3(x, -3, 0, 8) < 0.8) m.set(x, -3, 1, 'crop');

  // --- greenhouse and community garden ---
  block(3, 8, 10, 12);
  for (let x = 4; x <= 9; x++)
    for (let y = 8; y <= 11; y++) {
      const corner = (x === 4 || x === 9) && (y === 8 || y === 11);
      const fr = corner || (x + y) % 3 === 0;
      for (let z = 1; z <= 2; z++)
        if (x === 9 || y === 11 || z === 2)
          m.set(x, y, z, fr ? 'frame' : 'glassL', fr || z === 2 ? undefined : { win: true });
      m.set(x, y, 3, y === 8 || y === 11 ? 'frame' : 'glassL');
      if (y === 9 || y === 10)
        m.set(
          x,
          y,
          4,
          x === 4 || x === 9 ? 'frame' : 'glassL',
          x === 9 ? { win: true } : undefined,
        );
    }
  for (let x = 3; x <= 10; x++)
    for (let y = 15; y <= 19; y++)
      if (y % 2 && m.has(x, y, 0) && hash3(x, y, 0, 12) < 0.78)
        m.set(x, y, 1, hash3(x, y, 1, 13) < 0.25 ? 'leafY' : 'crop');
  block(3, 15, 10, 19);
  // orchard
  for (const [x, y, mat] of [
    [13, 9, 'leafO'],
    [16, 10, 'leafB'],
    [13, 12, 'leafB'],
    [16, 13, 'leafO'],
    [19, 11, 'leafY'],
  ] as const) {
    roundTree(m, x, y, 1, { th: 2, r: 1, mat });
    block(x - 1, y - 1, x + 1, y + 1);
  }

  // --- wind turbines ---
  const rotors = [];
  for (const [x, y, h, L] of [
    [20, 2, 13, 24],
    [12, 21, 10, 19],
  ]) {
    if (!m.has(x, y, 0)) continue;
    for (let z = 1; z <= h; z++) m.set(x, y, z, 'mast');
    m.set(x, y + 1, h, 'mast');
    block(x - 1, y - 1, x + 1, y + 1);
    rotors.push({ p: s(x + 0.5, y + 2.1, h + 0.5), L });
  }

  // --- park ---
  block(-19, 3, -5, 15);
  const trees: [number, number, string, number, number, string?][] = [
    [-18, 1, 'leafA', 3, 2, 'sway'],
    [-21, 6, 'leafC', 2, 2],
    [-6, 5, 'leafB', 3, 2, 'sway2'],
    [-4, 9, 'leafO', 2, 1],
    [-7, 18, 'leafA', 3, 2, 'sway'],
    [-17, 12, 'leafP', 2, 2],
    [-4, 20, 'leafC', 2, 1],
    [-17, 17, 'leafB', 2, 1],
    [-20, 9, 'leafY', 2, 1],
    [-9, 2, 'leafC', 2, 1],
    [-8, 12, 'leafB', 3, 2, 'sway2'],
    [-2, 6, 'leafB', 2, 1],
    [-2, 10, 'leafA', 2, 1],
    [-2, 17, 'leafB', 2, 1],
    [3, 9, 'leafA', 2, 1],
    [3, 16, 'leafB', 2, 1],
    [6, -16, 'leafA', 3, 2],
    [10, -15, 'leafC', 2, 1],
    [3, -19, 'leafB', 2, 1],
    [15, -15, 'leafO', 2, 1],
    [-19, -3, 'leafC', 2, 1],
    [20, -3, 'leafB', 2, 1],
    [5, 1, 'leafA', 2, 1],
    [-9, 20, 'leafA', 2, 1],
    [4, 18, 'leafP', 2, 1],
    [-1, -9, 'leafB', 2, 1],
    [1, -4, 'leafC', 2, 1],
    [-17, -9, 'leafA', 2, 1],
    [-9, -17, 'leafC', 2, 1],
    [1, -15, 'leafY', 2, 1],
    [16, 16, 'leafC', 2, 1],
    [7, 22, 'leafB', 2, 1],
  ];
  for (const [x, y, mat, th, r, g] of trees) {
    const z = ground(x, y);
    if (z === null) continue;
    roundTree(m, x, y, z + 1, { th, r, mat, g });
  }
  // pavilion with a planted roof, benches, bushes, lamps
  for (const [x, y] of [
    [-6, 9],
    [-6, 11],
    [-4, 9],
    [-4, 11],
  ])
    for (let z = 1; z <= 2; z++) m.set(x, y, z, 'timberD');
  for (let x = -7; x <= -3; x++)
    for (let y = 8; y <= 12; y++)
      m.set(x, y, 3, x === -7 || x === -3 || y === 8 || y === 12 ? 'timber' : 'sedum');
  for (const [x, y, mat] of [
    [-16, 5, 'plank'],
    [-15, 5, 'plank'],
    [-8, 14, 'plank'],
    [3, 2, 'plank'],
    [3, 3, 'plank'],
    [-3, 3, 'red'],
    [14, 7, 'yel'],
  ] as const)
    if (m.has(x, y, 0)) m.set(x, y, 1, mat);
  for (let i = 0; i < 46; i++) {
    const x = Math.round((hash3(i, 1, 0, 61) - 0.5) * 44),
      y = Math.round((hash3(i, 2, 0, 62) - 0.5) * 44);
    const z = ground(x, y);
    if (
      z === null ||
      m.has(x, y, z + 1) ||
      free.has(x + ',' + y) ||
      ['water', 'pave', 'bike', 'gravel', 'sand', 'soil'].includes(m.get(x, y, z)!.m)
    )
      continue;
    m.set(x, y, z + 1, ['leafB', 'leafC', 'leafA', 'leafY', 'leafP'][i % 5]);
  }
  const lamps = [
    [-2, 3],
    [3, 12],
    [-2, 13],
    [12, 3],
    [-8, 1],
    [-15, 14],
  ];
  for (const [x, y] of [
    [14, 7],
    [17, 8],
    [15, 8],
  ])
    if (m.has(x, y, 0)) m.set(x, y, 1, 'leafY');
  for (const [x0, y0, roof] of [
    [10, -19, 'sedum'],
    [14, -18, 'solar'],
  ] as const) {
    if (!m.has(x0 + 2, y0, 0)) continue;
    m.box(x0, y0, 1, x0 + 2, y0 + 2, 2, (x, y, z) =>
      z === 2 && y === y0 + 2 && x === x0 + 1 ? 'glass' : 'timber',
    );
    m.box(x0, y0, 3, x0 + 2, y0 + 2, 3, roof);
    m.get(x0 + 1, y0 + 2, 2)!.win = true;
  }
  for (const [x, y] of [
    [8, -13],
    [9, -13],
  ])
    if (m.has(x, y, 0)) m.set(x, y, 1, 'yel');
  const halos = [];
  for (const [x, y] of lamps) {
    if (!m.has(x, y, 0)) continue;
    m.set(x, y, 1, 'iron');
    m.set(x, y, 2, 'lamp', { lit: true });
    halos.push(s(x + 0.5, y + 0.5, 2.5));
  }
  // bridge over the stream, waterfall off the front-left edge
  for (let x = -14; x <= -11; x++) m.set(x, 15, 1, 'plank');
  for (const x of [-14, -11]) {
    m.set(x, 14, 1, 'timberD');
    m.set(x, 16, 1, 'timberD');
  }
  const falls = [];
  for (const x of [-12, -13]) {
    let ye = 10;
    while (m.has(x, ye + 1, 0)) ye++;
    falls.push([x, ye + 1]);
    for (let z = 0; z >= -12; z--) m.set(x, ye + 1, z, 'fall');
  }

  // --- render ---
  const main = layerOf(m, u);
  let fx = '';
  const waters = [...m.v.values()].filter((v) => v.m === 'water' && !m.has(v.x, v.y, v.z + 1));
  waters
    .filter((v) => hash3(v.x, v.y, 0, 71) < 0.16)
    .forEach((v, i) => {
      fx += `<polygon class="${i % 2 ? 'shim' : 'shim2'}" points="${diamond(s, v.x, v.y, v.z)}" fill="#e3f2f4" style="animation-delay: -${(i * 0.7).toFixed(1)}s"></polygon>`;
    });
  for (let k = 0; k < 7; k++) {
    const x = -12 - (k % 2),
      y = 10 + k + (k % 2);
    if (m.get(x, y, 0)?.m === 'water' && !m.has(x, y, 1))
      fx += `<polygon class="flow" points="${diamond(s, x, y, 0)}" fill="#eaf6f7" style="animation-delay: -${(k * 0.4).toFixed(1)}s"></polygon>`;
  }
  falls.forEach(([fxx, fyy], c) => {
    for (let k = 0; k < 5; k++) {
      const [ax, ay] = s(fxx, fyy + 1, -k * 2.4);
      fx += `<polygon class="drop" style="animation-delay: -${(k * 0.27 + c * 0.17).toFixed(2)}s" points="${ax},${ay} ${ax + 4},${ay + 2} ${ax + 4},${ay + 6} ${ax},${ay + 4}" fill="#ffffff"></polygon>`;
    }
  });
  const [mx0, my0] = s(falls[0][0], falls[0][1] + 1, -13);
  for (let k = 0; k < 3; k++)
    fx += `<g class="mist" style="animation-delay: -${(k * 0.9).toFixed(1)}s">${cubePoly(mx0 - 3 + k * 4, my0 + (k % 2) * 2, 2.4, '#ffffff', [1, 0.96, 0.92])}</g>`;
  // ducks on the pond
  const [dx0, dy0] = s(-14, 6, 1);
  fx += `<g class="koi">${cubePoly(dx0, dy0, 2, '#f7f5ee')}${cubePoly(dx0 + 2.4, dy0 - 0.2, 1, '#e8a03c')}</g><g class="koi koi2">${cubePoly(dx0 + 10, dy0 + 6, 2, '#f7f5ee')}${cubePoly(dx0 + 12.4, dy0 + 5.8, 1, '#e8a03c')}</g>`;
  // people: a walker on the promenade, a cyclist on the bike lane
  const [w1x, w1y] = s(0.5, 3.5, 1),
    [w2x, w2y] = s(-0.5, 18.5, 1),
    [cx, cy] = s(2.5, 20.5, 1);
  fx += `<g class="ecw1"><g class="wbob">${figure(w1x, w1y, '#d9694f', '#4b567e')}</g></g>`;
  fx += `<g class="ecw2"><g class="wbob">${figure(w2x, w2y, '#e3b94f', '#55628f')}</g></g>`;
  fx += `<g class="ecbike">${cubePoly(cx - 2.2, cy - 0.6, 1.6, '#2f333a')}${cubePoly(cx + 2.2, cy - 2.8, 1.6, '#2f333a')}${cubePoly(cx, cy - 4.2, 2.4, '#3f8f7a')}${cubePoly(cx, cy - 6.8, 2.2, '#e9c9ad')}${cubePoly(cx, cy - 8.6, 2.3, '#f3f1ea', [1, 0.9, 0.82])}</g>`;
  // turbine rotors: blades spin in the plane that faces the front-left
  const blade = (deg: number, L: number) => {
    const a = (deg * Math.PI) / 180,
      c = Math.cos(a),
      sn = Math.sin(a);
    const P = (x: number, y: number) =>
      `${(x * c - y * sn).toFixed(2)},${(x * sn + y * c).toFixed(2)}`;
    return `<polygon points="${P(0, -1.7)} ${P(L * 0.35, -1.4)} ${P(L, -0.4)} ${P(L, 0.4)} ${P(0, 1.7)}" fill="#f4f6f7"></polygon><polygon points="${P(0, 0.2)} ${P(L, 0.4)} ${P(0, 1.7)}" fill="#d9dee3"></polygon>`;
  };
  for (const [i, r] of rotors.entries())
    fx += `<g transform="translate(${r.p[0]} ${r.p[1]})"><g transform="matrix(1 0.5 0 1 0 0)"><g class="ecspin${i ? ' ecspin2' : ''}">${blade(-90, r.L)}${blade(30, r.L)}${blade(150, r.L)}<circle cx="0" cy="0" r="2.2" fill="#cfd5da"></circle></g></g></g>`;
  const [bx0, bx1, by0, by1] = main.r.bounds();
  const ORG = [300, 124];
  const mainSvg = svgWrap(
    `<ellipse class="shadow" cx="${ORG[0]}" cy="232" rx="124" ry="6" fill="#1b2340" fill-opacity="0.1"></ellipse><g transform="translate(${ORG[0]} ${ORG[1]})"><g class="float">${main.svg}${fx}</g></g>`,
  );
  const gh = s(7, 10.5, 2);
  const glow = svgWrap(
    `<g transform="translate(${ORG[0]} ${ORG[1]})"><g class="float">${vx(main.r.wins, 'wins')}${halos
      .slice(0, 4)
      .map(
        (h, i) =>
          `<circle class="halo${i % 2 ? ' halo2' : ''}" cx="${h[0]}" cy="${h[1]}" r="${i < 2 ? 22 : 16}" fill="url(#ec-glow)"></circle>`,
      )
      .join(
        '',
      )}<circle class="door-glow" cx="${gh[0]}" cy="${gh[1]}" r="20" fill="url(#ec-glow)"></circle>${vx(main.r.lit, 'lit')}</g></g>`,
    'vq-art vq-glow',
  );

  // --- far islets, clouds, front islet ---
  const islet = (
    uu: number,
    seed: number,
    rx: number,
    ry: number,
    deco: (model: Model) => void,
  ) => {
    const mm = new Model();
    island(mm, { rx, ry, seed, depth: Math.max(4, rx * 0.9), rough: 0.35, surf: () => 'lawn' });
    deco(mm);
    return layerOf(mm, uu).svg;
  };
  const far1 = islet(2, 3, 8, 7, (mm) => {
    roundTree(mm, -2, 1, 1, { th: 2, r: 2, mat: 'leafA', g: 'sway' });
    roundTree(mm, 3, -2, 1, { th: 2, r: 1, mat: 'leafO' });
    for (let z = 1; z <= 9; z++) mm.set(4, 3, z, 'mast');
    mm.box(-5, -4, 1, -3, -2, 2, 'white');
    mm.box(-5, -4, 3, -3, -2, 3, 'solar');
  });
  const far2 = islet(2, 5, 6, 6, (mm) => {
    roundTree(mm, 0, 0, 1, { th: 2, r: 2, mat: 'leafB', g: 'sway' });
    mm.set(3, 2, 1, 'leafY');
  });
  const far3 = islet(2, 8, 4, 4, (mm) => {
    roundTree(mm, 0, 0, 1, { th: 1, r: 1, mat: 'leafC' });
  });
  const [fr] = [S(2)(4.5, 5, 9.5)];
  const farRotor = `<g transform="translate(${660 + fr[0]} ${62 + fr[1]})"><g transform="matrix(1 0.5 0 1 0 0)"><g class="ecspin ecspin2">${blade(-90, 9)}${blade(30, 9)}${blade(150, 9)}</g></g></g>`;
  const far = svgWrap(
    `<g transform="translate(660 62)"><g class="float3">${far1}</g></g>${farRotor}<g transform="translate(150 96)"><g class="float2">${far2}</g></g><g transform="translate(590 180)"><g class="float3">${far3}</g></g><g class="cf"><g transform="translate(420 38)">${cloudSvg(9, 5, 4, 2, 2)}</g></g><g class="cf cf2"><g transform="translate(180 22)">${cloudSvg(7, 4, 6, 2, 2)}</g></g>${BIRDS}`,
  );
  const clouds = svgWrap(
    `${glowDefs('ec')}<g class="cl c1"><g transform="translate(90 40)">${cloudSvg(9, 5, 1)}</g></g><g class="cl c2"><g transform="translate(520 150)">${cloudSvg(8, 4, 2)}</g></g><g class="cl c3"><g transform="translate(330 26)">${cloudSvg(7, 4, 3)}</g></g>`,
  );
  const frontIslet = islet(6, 14, 5, 4, (mm) => {
    roundTree(mm, 0, 0, 1, { th: 2, r: 2, mat: 'leafB', g: 'sway' });
    mm.set(2, 2, 1, 'leafY');
    mm.set(-2, 2, 1, 'plank');
    mm.set(3, -1, 1, 'leafP');
  });
  const front = svgWrap(
    `<g transform="translate(46 212)"><g class="float2">${frontIslet}</g></g><g class="wisp"><g transform="translate(250 214)">${cloudSvg(10, 5, 21, 3, 2)}</g></g><g class="wisp wisp2"><g transform="translate(520 224)">${cloudSvg(8, 4, 22, 3, 2)}</g></g>`,
  );
  return {
    layers: { far, clouds, main: mainSvg, front, glow },
    stats: { voxels: m.v.size, bounds: [bx0 + ORG[0], bx1 + ORG[0], by0 + ORG[1], by1 + ORG[1]] },
  };
}
export const ecoCss = `
.vq .ecspin { animation: ecspin 9s linear infinite; }
.vq .ecspin2 { animation-duration: 12s; animation-delay: -4s; }
@keyframes ecspin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
.vq .ecw1 { animation: ecw1 30s linear infinite; }
@keyframes ecw1 { 0%, 4% { transform: translate(0, 0) } 46%, 54% { transform: translate(-52px, 26px) } 96%, 100% { transform: translate(0, 0) } }
.vq .ecw2 { animation: ecw2 24s linear infinite; animation-delay: -9s; }
@keyframes ecw2 { 0%, 6% { transform: translate(0, 0) } 44%, 56% { transform: translate(28px, -14px) } 94%, 100% { transform: translate(0, 0) } }
.vq .ecbike { animation: ecbike 13s linear infinite; }
@keyframes ecbike { 0% { transform: translate(0, 0); opacity: 0 } 6% { opacity: 1 } 88% { opacity: 1 } 96%, 100% { transform: translate(56px, -28px); opacity: 0 } }
`;
