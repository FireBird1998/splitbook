// Fig 1 · The splitting line: each Expense is a bar of chips, one chip per share. A saw cuts it, and
// pneumatic pushers send each chip down a chute into the bin of the member it belongs to. The payer's
// counter rises by the whole bar, each bin's counter falls by its chips, so the counters always add
// up to zero. Every number comes from the story model, which uses Splitbook's own money code.
import * as k from '../../vendor/anatomy/kit/iso-kit.mjs';
import * as G from '../../vendor/anatomy/kit/lathe.mjs';
import * as A from '../../vendor/anatomy/kit/audit.mjs';
import { tubePieces, tubeSvg } from '../../vendor/anatomy/kit/tube.mjs';
import { andList, word } from './common.mjs';

export function buildSplittingLine(STORY) {
  const IDS = STORY.members.map((m) => m.id);

  const W = 840;
  const H = 440;

  // ---------------------------------------------------------------- world
  const PLATE = { x: -296, y: -86, w: 528, d: 150, r: 10 };
  const PLATE_H = 12;
  const FOOT_H = 5;
  const BELT = { x0: -232, x1: 206, y0: -23, y1: -1, top: 28 };
  const RAIL_D = 3;
  const CW = 12; // chip pitch along the belt
  const CHIP = { d: 14, h: 3 };
  const CHIP_Y = (BELT.y0 + BELT.y1) / 2;
  const XS = [-70, 0, 70, 140];
  const BLADE_X = -144.5;
  const COLUMN = [BLADE_X, -50];
  const ARM_Z = 86;
  const MAG_X = -265;
  const PUSH = { y0: -64, gland: -40, z: 32, r: 4.2, rod: 1.2, rest: -27, stroke: 27 };
  const BIN = { y0: 14, y1: 44, h: 16, t: 1.5, half: 18 };
  const MANIFOLD = { x: -94, y: -80, w: 254, d: 9, h: 10, r: 1.5 };

  const P = k.fitProjection(
    [
      ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
      [COLUMN[0], COLUMN[1], ARM_Z + 24],
      [PLATE.x + PLATE.w, -40, 40],
      [-232, -70, 92],
    ],
    W,
    H,
    { pad: 24, azimuth: 60, elevation: 30 },
  );
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dots = (points, style) => k.dotsSvg(points, style);
  const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

  const R = A.recorder(P);
  const record = R.solid;
  function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
    return R.put({ name, at: ref, bias, svg, shapes, piece: 'line', ...rest });
  }
  function box(
    name,
    plan,
    z0,
    h,
    style = {},
    { steps = 4, bevel = 0, extra = '', inner = '', bias = 0, ref, owner } = {},
  ) {
    const shape = record(A.slab(plan, z0, h, { name, owner }, steps));
    put(
      name,
      ref ?? [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + h / 2],
      S(k.slabOf(plan, z0, h, P, steps, bevel), { tone: 'mid', ...style, inner }) + extra,
      [shape],
      { bias },
    );
    return shape;
  }
  function post(
    name,
    cx,
    cy,
    r,
    z0,
    h,
    style = {},
    { extra = '', inner = '', bias = 0, steps = 24 } = {},
  ) {
    const shape = record(A.cylinder(cx, cy, r, z0, h, { name }));
    put(
      name,
      [cx, cy, z0 + h / 2],
      S(k.cylinder(cx, cy, r, z0, h, P, steps), { tone: 'mid', ...style, inner }) + extra,
      [shape],
      { bias },
    );
    return shape;
  }
  function turned(
    name,
    F,
    profile,
    style = {},
    { extra = '', inner = '', bias = 0, owner, ref } = {},
  ) {
    const shape = record(A.solid(F, profile, { name, owner }));
    const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
    put(
      name,
      ref ?? G.add3(F.o, G.mul3(F.a, mid)),
      S(G.solidOf(profile, F, P), { tone: 'mid', ...style, inner }) + extra,
      [shape],
      { bias },
    );
    return shape;
  }
  const disc = (name, F, s0, s1, r, style, options) =>
    turned(
      name,
      F,
      [
        [s0, r],
        [s1, r],
      ],
      style,
      options,
    );
  function prism(name, F, poly, s0, s1, style = {}, { extra = '', bias = 0, ref } = {}) {
    const shape = record(A.prism(F, poly, s0, s1, { name }));
    const cu = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cv = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const centre = G.add3(
      G.add3(G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), G.mul3(F.u, cu)),
      G.mul3(F.v, cv),
    );
    put(
      name,
      ref ?? centre,
      S(G.prismOf(F, poly, s0, s1, P), { tone: 'mid', ...style }) + extra,
      [shape],
      { bias },
    );
    return shape;
  }
  function planeMatrix(o, ex, ey) {
    const p0 = at(o);
    const px = at(G.add3(o, ex));
    const py = at(G.add3(o, ey));
    const v = (x) => x.toFixed(4);
    return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
  }
  const XF = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const YF = (x, y, z) => G.frameOf([x, y, z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const ZF = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  // a recessed window on a face that points +y, with clipped content drawn in the face plane
  function faceWindow(id, y, u0, u1, z0, z1, depth, content, glass = 'ln-glass') {
    const f = (u, z, off = 0) => [u, y - off, z];
    const outer = path3([f(u0, z0), f(u1, z0), f(u1, z1), f(u0, z1)], true);
    const backFace = path3(
      [f(u0, z0, depth), f(u1, z0, depth), f(u1, z1, depth), f(u0, z1, depth)],
      true,
    );
    const floor = path3([f(u0, z0), f(u1, z0), f(u1, z0, depth), f(u0, z0, depth)], true);
    const side = path3([f(u0, z0), f(u0, z1), f(u0, z1, depth), f(u0, z0, depth)], true);
    return `<clipPath id="${id}"><path d="${outer}"/></clipPath><g clip-path="url(#${id})"><path class="${glass}" d="${backFace}"/><path class="iso-shade" data-shade="1" d="${floor}"/><path class="iso-shade" data-shade="2" d="${side}"/><g transform="${planeMatrix(f(u0, z1, depth), [1, 0, 0], [0, 0, -1])}">${content}</g></g><path class="iso-line" data-tone="lo" d="${outer}"/>`;
  }

  // ---------------------------------------------------------------- base
  const back = [];
  back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
  const byDepth = (points) =>
    [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: 'lo' }));
    back.push(
      S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: 'mid' }),
    );
  }
  back.push(
    S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), {
      tone: 'mid',
      inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: 'faint' }),
    }),
  );
  back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: 'lo' }));
  const plateScrews = k.corners(PLATE, 10);
  back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(''), { tone: 'lo' }));
  back.push(
    Dots(
      plateScrews.map(([x, y]) => at([x, y, 0])),
      { size: 0.5 },
    ),
  );
  record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: 'stand.plate', ground: true }, 8));
  const STRIP = { x: -100, y: PLATE.y + PLATE.d - 11, w: 316, d: 5.5, r: 1 };
  back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: 'lo', crease: 'none' }));
  {
    const t = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.6, 3], P);
    back.push(Ln(t.minor, { tone: 'lo' }), Ln(t.major, { tone: 'mid' }));
    back.push(
      Dots(
        [at([STRIP.x + 2, STRIP.y + 2.75, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 2.75, 0.6])],
        { size: 0.45 },
      ),
    );
  }
  const LABEL = { x: -262, y: 20, w: 46, d: 15, r: 1.2 };
  back.push(S(k.slabOf(LABEL, 0, 0.8, P, 4), { tone: 'lo' }));
  back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.6), 0.8, P, 4), { tone: 'faint' }));
  back.push(
    Ln(
      [
        [LABEL.x + 7, LABEL.y + 4.8, 30],
        [LABEL.x + 7, LABEL.y + 7.5, 22],
        [LABEL.x + 7, LABEL.y + 10.2, 26],
      ]
        .map(([x, y, len]) => k.lineOnTop([x, y], [x + len, y], 0.8, P))
        .join(''),
      { tone: 'lo', free: true },
    ),
  );
  back.push(
    Dots(
      [at([LABEL.x + 3.4, LABEL.y + 7.5, 0.8]), at([LABEL.x + LABEL.w - 3.4, LABEL.y + 7.5, 0.8])],
      { size: 0.45 },
    ),
  );
  // floor markings: a walkway line along the front of the bins
  back.push(
    Ln(k.planOutline({ x: -96, y: BIN.y1 + 3, w: 252, d: 2.4, r: 1 }, 0, P, 3), { tone: 'faint' }),
  );

  // ---------------------------------------------------------------- conveyor
  {
    const railB = {
      x: BELT.x0 - 6.5,
      y: BELT.y0 - RAIL_D,
      w: BELT.x1 - BELT.x0 + 13,
      d: RAIL_D,
      r: 0.8,
    };
    const railF = { x: BELT.x0 - 6.5, y: BELT.y1, w: BELT.x1 - BELT.x0 + 13, d: RAIL_D, r: 0.8 };
    const bolts = (y) =>
      Ln(
        Array.from({ length: 18 }, (_, i) =>
          k.sideRing([BELT.x0 + 12 + i * 24, y, BELT.top - 4], 1.1, 'y', P, 14),
        ).join(''),
        { tone: 'lo' },
      );
    box('conv.railB', railB, 18, BELT.top - 18, { tone: 'mid' }, { steps: 2, bevel: 0.3 });
    box(
      'conv.belt',
      { x: BELT.x0, y: BELT.y0, w: BELT.x1 - BELT.x0, d: BELT.y1 - BELT.y0, r: 0.5 },
      25.4,
      BELT.top - 25.4,
      { tone: 'lo', crease: 'faint' },
      { steps: 2, extra: `<g data-part="belt-marks"></g>` },
    );
    box(
      'conv.railF',
      railF,
      18,
      BELT.top - 18,
      { tone: 'mid' },
      {
        steps: 2,
        bevel: 0.3,
        inner: Ln(k.sideSeam(railF, 22, P, 2), { tone: 'faint' }),
        extra: bolts(BELT.y1 + RAIL_D),
      },
    );
    // end drums
    for (const [name, x] of [
      ['conv.drumL', BELT.x0 - 2.6],
      ['conv.drumR', BELT.x1 + 2.6],
    ]) {
      const F = YF(x, BELT.y0, BELT.top - 2.6);
      disc(name, F, 0, BELT.y1 - BELT.y0, 2.6, { tone: 'mid', crease: 'none' }, { bias: -0.05 });
    }
    // legs with braces
    for (const x of [-222, -120, -20, 80, 176]) {
      for (const y of [BELT.y0 - RAIL_D / 2, BELT.y1 + RAIL_D / 2]) {
        post(
          `conv.leg${x}${y > 0 ? 'F' : 'B'}`,
          x,
          y,
          1.8,
          2,
          16,
          { tone: 'mid', crease: 'none' },
          { steps: 14 },
        );
        box(
          `conv.pad${x}${y > 0 ? 'F' : 'B'}`,
          { x: x - 3.4, y: y - 3.4, w: 6.8, d: 6.8, r: 1 },
          0,
          2,
          { tone: 'lo' },
          { steps: 2 },
        );
      }
      box(
        `conv.brace${x}`,
        {
          x: x - 1,
          y: BELT.y0 - RAIL_D / 2 + 1.8,
          w: 2,
          d: BELT.y1 - BELT.y0 + RAIL_D - 3.6,
          r: 0.4,
        },
        7,
        2.2,
        { tone: 'lo' },
        { steps: 2 },
      );
    }
    // drive: gearbox at the right end behind the belt, motor pointing back
    box(
      'drive.box',
      { x: BELT.x1 - 18, y: BELT.y0 - RAIL_D - 13, w: 16, d: 13, r: 1.5 },
      14,
      16,
      { tone: 'mid' },
      {
        steps: 3,
        bevel: 0.5,
        extra: Dots(
          k
            .corners({ x: BELT.x1 - 18, y: BELT.y0 - RAIL_D - 13, w: 16, d: 13, r: 1.5 }, 2.2)
            .map(([x, y]) => at([x, y, 30])),
          { size: 0.45 },
        ),
      },
    );
    const MF = YF(BELT.x1 - 10, BELT.y0 - RAIL_D - 13, 22);
    turned(
      'drive.motor',
      G.frameOf([BELT.x1 - 10, BELT.y0 - RAIL_D - 13, 22], [0, -1, 0], [1, 0, 0], [0, 0, 1]),
      [
        [0, 6.4],
        [2, 6.4],
        [2, 6],
        [18, 6],
        [18, 5],
        [21, 4.2],
      ],
      { tone: 'mid' },
      {
        extra: k.fadedSvg(
          G.ribsOf(
            G.frameOf([BELT.x1 - 10, BELT.y0 - RAIL_D - 13, 22], [0, -1, 0], [1, 0, 0], [0, 0, 1]),
            3.5,
            16.5,
            6,
            22,
            P,
            { fade: [0.1, 0.55], seams: true },
          ),
          { tone: 'lo' },
        ),
      },
    );
    void MF;
    box(
      'drive.base',
      { x: BELT.x1 - 20, y: BELT.y0 - RAIL_D - 36, w: 20, d: 36, r: 1.5 },
      0,
      14,
      { tone: 'lo' },
      { steps: 3, bevel: 0.4 },
    );
  }

  // ---------------------------------------------------------------- magazine of Expense bars
  {
    const MAG = { x: MAG_X - 26, x1: MAG_X + 26 };
    for (const [name, y] of [
      ['mag.guideB', BELT.y0 - 3],
      ['mag.guideF', BELT.y1],
    ]) {
      box(
        name,
        { x: MAG.x, y, w: MAG.x1 - MAG.x, d: 3, r: 0.8 },
        0,
        29,
        { tone: 'mid' },
        {
          steps: 2,
          bevel: 0.3,
          extra: Dots([at([MAG.x + 4, y + 1.5, 29]), at([MAG.x1 - 4, y + 1.5, 29])], { size: 0.4 }),
        },
      );
    }
    box(
      'mag.floor',
      { x: MAG.x, y: BELT.y0, w: MAG.x1 - MAG.x, d: BELT.y1 - BELT.y0, r: 0.6 },
      0,
      18,
      { tone: 'lo' },
      { steps: 2 },
    );
    box(
      'mag.lift',
      { x: MAG.x + 2, y: BELT.y0 + 2, w: MAG.x1 - MAG.x - 4, d: BELT.y1 - BELT.y0 - 4, r: 0.6 },
      18,
      2.6,
      { tone: 'mid' },
      { steps: 2, bevel: 0.3 },
    );
  }

  // ---------------------------------------------------------------- dicing saw on a C-frame column
  const SAW = {};
  {
    const [cx, cy] = COLUMN;
    box(
      'saw.foot',
      { x: cx - 9, y: cy - 9, w: 18, d: 18, r: 2 },
      0,
      4,
      { tone: 'mid' },
      {
        steps: 3,
        bevel: 0.5,
        extra: Dots(
          k
            .corners({ x: cx - 9, y: cy - 9, w: 18, d: 18, r: 2 }, 2.6)
            .map(([x, y]) => at([x, y, 4])),
          { size: 0.45 },
        ),
      },
    );
    post(
      'saw.column',
      cx,
      cy,
      4.4,
      4,
      ARM_Z - 4,
      { tone: 'mid', crease: 'none' },
      {
        inner: Ln([30, 60].map((z) => k.sideArc(cx, cy, 4.4, z, P, 18)).join(''), {
          tone: 'faint',
        }),
      },
    );
    const arm = { x: cx - 5, y: cy - 6, w: 10, d: 6 - (cy - 6), r: 1.5 };
    box(
      'saw.arm',
      arm,
      ARM_Z,
      8,
      { tone: 'mid' },
      { steps: 3, bevel: 0.5, inner: Ln(k.sideSeam(arm, ARM_Z + 2.5, P, 3), { tone: 'faint' }) },
    );
    SAW.arm = arm;
  }
  // the moving head: carriage on the arm, a Z slide, a spindle and the blade
  function sawHeadSvg() {
    const carriage = { x: BLADE_X - 9.5, y: -7, w: 19, d: 14, r: 2 };
    const slide = { x: BLADE_X - 7, y: -2.4, w: 9, d: 4.8, r: 0.8 };
    const SP = XF(0, 0, 50);
    const spindle = S(
      G.solidOf(
        [
          [BLADE_X - 12, 4.6],
          [BLADE_X - 2.4, 4.6],
          [BLADE_X - 2.4, 3.2],
          [BLADE_X - 1.2, 3.2],
        ],
        SP,
        P,
      ),
      { tone: 'mid', inner: Ln(G.arcOf(SP, BLADE_X - 8, 4.6, P), { tone: 'faint' }) },
    );
    const flange = S(G.disc(BLADE_X - 1.2, BLADE_X - 0.5, 6.2, SP, P), { tone: 'mid' });
    const blade = S(G.disc(BLADE_X - 0.5, BLADE_X + 0.5, 11, SP, P, { steps: 64 }), { tone: 'hi' });
    const hub = Dots(G.dotsOf(SP, BLADE_X + 0.5, 3.6, 4, P, { all: true }), {
      size: 0.4,
      tone: 'lo',
    });
    const guardPoly = Array.from({ length: 19 }, (_, i) => {
      const t = (i / 18) * Math.PI;
      return [Math.cos(t) * 12.6, Math.sin(t) * 12.6];
    }).concat(
      Array.from({ length: 19 }, (_, i) => {
        const t = Math.PI - (i / 18) * Math.PI;
        return [Math.cos(t) * 11.4, Math.sin(t) * 11.4];
      }),
    );
    const guard = S(G.prismOf(SP, guardPoly, BLADE_X - 1.6, BLADE_X + 1.6, P), { tone: 'mid' });
    return {
      slide:
        S(k.slabOf(slide, 46, 50, P, 2, 0.3), { tone: 'mid' }) +
        spindle +
        flange +
        `<g data-part="blade">${blade}${hub}</g>` +
        guard,
      carriage:
        S(k.slabOf(carriage, ARM_Z - 6, 20, P, 3, 0.6), {
          tone: 'hi',
          crease: 'lo',
          inner: Ln(k.sideSeam(carriage, ARM_Z + 10, P, 3), { tone: 'faint' }),
        }) +
        Dots([at([BLADE_X - 6, 7, ARM_Z + 4]), at([BLADE_X + 6, 7, ARM_Z + 4])], {
          size: 0.9,
          tone: 'mid',
        }),
    };
  }
  const HEAD = sawHeadSvg();

  // control cabinet with the screen and a stack light, in front of the saw
  {
    const CAB = { x: -252, y: -78, w: 40, d: 22, r: 2.5 };
    const CAB_H = 64;
    const lines = [0, 1, 2]
      .map(
        (i) =>
          `<text class="ln-screen" data-line="${i}" x="2.2" y="${(5 + i * 5.6).toFixed(1)}" font-size="${i === 1 ? 4.8 : 4}"></text>`,
      )
      .join('');
    const screen = faceWindow(
      'ln-screen',
      CAB.y + CAB.d,
      CAB.x + 5,
      CAB.x + CAB.w - 5,
      40,
      58,
      1.4,
      lines,
    );
    const buttons = [CAB.x + 9, CAB.x + 17]
      .map((x) => k.sideRing([x, CAB.y + CAB.d, 35], 1.6, 'y', P, 16))
      .join('');
    box(
      'cab.body',
      CAB,
      0,
      CAB_H,
      { tone: 'mid' },
      {
        steps: 4,
        bevel: 0.6,
        inner: Ln(k.sideSeam(CAB, 3, P, 4) + k.sideSeam(CAB, 30, P, 4), { tone: 'faint' }),
        extra:
          screen +
          Ln(buttons, { tone: 'mid' }) +
          Ln(k.planOutline(k.insetPlan(CAB, 2.6), CAB_H, P, 4), { tone: 'faint' }) +
          Dots(
            k.corners(CAB, 2.4).map(([x, y]) => at([x, y, CAB_H])),
            { size: 0.45 },
          ),
      },
    );
    const LX = CAB.x + CAB.w - 7;
    const LY = CAB.y + 6;
    post('cab.pole', LX, LY, 1, CAB_H, 10, { tone: 'mid' }, { steps: 12 });
    [0, 1, 2].forEach((i) => {
      const z = CAB_H + 10 + i * 4.2;
      post(
        `cab.lamp${i}`,
        LX,
        LY,
        3.2,
        z,
        3.8,
        { tone: i === 0 ? 'hi' : 'mid' },
        {
          steps: 24,
          extra:
            i === 0
              ? `<path class="ln-lamp" data-lamp="run" d="${k.cylinder(LX, LY, 3.2, z, 3.8, P, 24).fill}"/>`
              : '',
        },
      );
      if (i < 2) post(`cab.lampring${i}`, LX, LY, 3.4, z + 3.8, 0.4, { tone: 'lo' }, { steps: 24 });
    });
    post('cab.lampcap', LX, LY, 2.2, CAB_H + 22.2, 1.4, { tone: 'mid' }, { steps: 18 });
  }

  // ---------------------------------------------------------------- sorting stations: pusher, chute, bin, counter, payer lamp
  const stationSlots = [];
  XS.forEach((cx, index) => {
    // pedestal and cylinder behind the belt
    box(
      `st${index}.pedestal`,
      { x: cx - 5, y: PUSH.y0 + 4, w: 10, d: 16, r: 1.2 },
      0,
      PUSH.z - PUSH.r,
      { tone: 'mid' },
      {
        steps: 3,
        bevel: 0.4,
        extra: Dots(
          [
            at([cx - 2.6, PUSH.y0 + 6.5, PUSH.z - PUSH.r]),
            at([cx + 2.6, PUSH.y0 + 17.5, PUSH.z - PUSH.r]),
          ],
          { size: 0.4 },
        ),
      },
    );
    const CF = YF(cx, PUSH.y0, PUSH.z);
    const len = PUSH.gland - PUSH.y0;
    turned(
      `st${index}.cylinder`,
      CF,
      [
        [0, PUSH.r + 0.8],
        [2, PUSH.r + 0.8],
        [2, PUSH.r],
        [len - 2, PUSH.r],
        [len - 2, PUSH.r + 0.8],
        [len, PUSH.r + 0.8],
      ],
      { tone: 'mid' },
      {
        extra: Dots(G.dotsOf(CF, len, PUSH.r - 0.4, 4, P, { phase: Math.PI / 4, all: true }), {
          size: 0.4,
          tone: 'lo',
        }),
      },
    );
    disc(
      `st${index}.port`,
      G.frameOf([cx, PUSH.y0, PUSH.z], [0, -1, 0], [1, 0, 0], [0, 0, 1]),
      0,
      2.4,
      1.9,
      { tone: 'mid' },
    );
    // rod and head: one rod out of the gland, the head plate on its tip
    const RF = YF(cx, PUSH.gland, PUSH.z);
    const rodTo = PUSH.rest - 2 - PUSH.gland;
    const ROD = G.rodOut(RF, 0, rodTo, PUSH.rod, P, { stroke: PUSH.stroke });
    const head = { x: cx - 6, y: PUSH.rest - 2, w: 12, d: 2, r: 0.5 };
    const svg =
      `<clipPath id="ln-rod${index}"><path data-hold d="${ROD.clip}"/></clipPath><g clip-path="url(#ln-rod${index})">${S(ROD.paths, { tone: 'hi' })}</g>` +
      S(k.slabOf(head, BELT.top + 0.6, 6.4, P, 2, 0.3), { tone: 'hi', crease: 'lo' }) +
      Dots([at([cx - 3.4, PUSH.rest, BELT.top + 5]), at([cx + 3.4, PUSH.rest, BELT.top + 5])], {
        size: 0.4,
        tone: 'lo',
      });
    put(
      `st${index}.rod`,
      [cx, PUSH.rest - 8, PUSH.z],
      `<g data-pusher="${index}">${svg}</g>`,
      [
        record(A.slide(RF, 0, rodTo, PUSH.rod, { name: `st${index}.rod` })),
        record(
          A.slab(
            head,
            BELT.top + 0.6,
            6.4,
            { name: `st${index}.head`, owner: `st${index}.rod` },
            2,
          ),
        ),
      ],
      { bias: 0.4 },
    );
    // chute from the belt's front edge down to the bin
    const chuteF = G.frameOf([cx - 9, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const yA = BELT.y1 + RAIL_D;
    const chute = [
      [yA, BELT.top - 0.4],
      [BIN.y0 + 1.6, BIN.h + 1.4],
      [BIN.y0 + 1.6, BIN.h - 0.2],
      [yA, BELT.top - 2],
    ];
    prism(`st${index}.chute`, chuteF, chute, 0, 18, { tone: 'mid' });
    for (const [side, s0] of [
      ['L', -1.4],
      ['R', 18],
    ]) {
      const lip = [
        [yA, BELT.top - 0.4],
        [BIN.y0 + 1.6, BIN.h + 1.4],
        [BIN.y0 + 1.6, BIN.h + 4],
        [yA, BELT.top + 2.2],
      ];
      prism(
        `st${index}.lip${side}`,
        chuteF,
        lip,
        s0,
        s0 + 1.4,
        { tone: 'mid' },
        { bias: side === 'R' ? 0.05 : -0.05 },
      );
    }
    // the bin: floor, back and sides first, the falling chips, then the front with the counter and payer lamp
    const B = { x: cx - BIN.half, y: BIN.y0, w: BIN.half * 2, d: BIN.y1 - BIN.y0 };
    box(`st${index}.binFloor`, { ...B, r: 1.2 }, 0, 1.6, { tone: 'lo' }, { steps: 2 });
    box(
      `st${index}.binBack`,
      { x: B.x, y: B.y, w: B.w, d: BIN.t, r: 0.4 },
      1.6,
      BIN.h - 1.6,
      { tone: 'mid' },
      { steps: 2 },
    );
    box(
      `st${index}.binL`,
      { x: B.x, y: B.y + BIN.t, w: BIN.t, d: B.d - 2 * BIN.t, r: 0.4 },
      1.6,
      BIN.h - 1.6,
      { tone: 'mid' },
      { steps: 2 },
    );
    box(
      `st${index}.binR`,
      { x: B.x + B.w - BIN.t, y: B.y + BIN.t, w: BIN.t, d: B.d - 2 * BIN.t, r: 0.4 },
      1.6,
      BIN.h - 1.6,
      { tone: 'mid' },
      { steps: 2 },
    );
    const digits = `<text class="ln-digits" data-count="${index}" x="${(25 - 1.4).toFixed(1)}" y="6.3" font-size="5.6" text-anchor="end">0</text>`;
    const counter = faceWindow(`ln-count${index}`, BIN.y1, cx - 17, cx + 8, 4, 12, 1.2, digits);
    const lamp =
      `<path class="ln-paylamp" data-paid="${index}" d="${G.circleOf(YF(cx + 12.6, BIN.y1, 8), 0.3, 2.2, P)}"/>` +
      Ln(G.circleOf(YF(cx + 12.6, BIN.y1, 8), 0.3, 2.2, P), { tone: 'mid' });
    box(
      `st${index}.binFront`,
      { x: B.x, y: BIN.y1 - BIN.t, w: B.w, d: BIN.t, r: 0.4 },
      1.6,
      BIN.h - 1.6,
      { tone: 'mid' },
      {
        steps: 2,
        bias: 30,
        extra:
          counter +
          lamp +
          Ln(k.planOutline({ x: B.x, y: BIN.y1 - BIN.t, w: B.w, d: BIN.t, r: 0.4 }, BIN.h, P, 2), {
            tone: 'faint',
          }),
      },
    );
    // air line from the manifold to the cylinder's rear port
    const portEnd = [cx, PUSH.y0 - 2.4, PUSH.z];
    const manifoldTop = [cx - 1.5, MANIFOLD.y + MANIFOLD.d / 2, MANIFOLD.h + 8 + 2.2];
    const route = G.fillet(
      [portEnd, [cx, manifoldTop[1] + 2, PUSH.z], [cx - 1.5, manifoldTop[1], PUSH.z], manifoldTop],
      4.4,
      10,
      { P, tube: 1.2 },
    );
    R.route(`air${index}`, route, 1.2, {
      piece: 'line',
      touch: [`st${index}.port`, `man.port${index}`],
    });
    tubePieces(route, 1.2, P, { maxLength: 12 }).forEach((piece, i) =>
      put(
        `air${index}:${i}`,
        piece.mid,
        tubeSvg(piece, { tone: 'mid' }),
        [A.tube(piece.points, piece.radii)],
        { bias: 0.05 },
      ),
    );
    const EX = cx - 16;
    const eye = { x: EX - 2.6, y: BELT.y1 + RAIL_D, w: 5.2, d: 4.4, r: 0.8 };
    box(
      `st${index}.eye`,
      eye,
      BELT.top - 3,
      8,
      { tone: 'hi', crease: 'lo' },
      {
        steps: 2,
        bevel: 0.3,
        extra: Dots(
          [
            at([EX - 1.2, eye.y + eye.d, BELT.top + 3]),
            at([EX + 1.2, eye.y + eye.d, BELT.top + 3]),
          ],
          { size: 0.5, tone: 'mid' },
        ),
      },
    );
    const refl = { x: EX - 2.4, y: BELT.y0 - RAIL_D - 2.2, w: 4.8, d: 2.2, r: 0.5 };
    box(
      `st${index}.reflector`,
      refl,
      BELT.top - 3,
      7,
      { tone: 'mid' },
      {
        steps: 2,
        extra: Ln(k.planOutline(k.insetPlan(refl, 0.6), BELT.top + 4, P, 2), { tone: 'faint' }),
      },
    );
    stationSlots.push(index);
  });

  // manifold with four ports, fed from a filter-regulator on the left
  box(
    'man.block',
    MANIFOLD,
    0,
    MANIFOLD.h,
    { tone: 'mid' },
    {
      steps: 3,
      bevel: 0.5,
      inner: Ln(k.sideSeam(MANIFOLD, 4, P, 3), { tone: 'faint' }),
      extra: Dots(
        [MANIFOLD.x + 4, MANIFOLD.x + MANIFOLD.w - 4].map((x) =>
          at([x, MANIFOLD.y + MANIFOLD.d / 2, MANIFOLD.h]),
        ),
        { size: 0.45 },
      ),
    },
  );
  const VALVE_TOP = MANIFOLD.h + 8;
  XS.forEach((cx, index) => {
    const VY = MANIFOLD.y + 0.5;
    const valve = { x: cx - 5, y: VY, w: 10, d: MANIFOLD.d - 1, r: 1 };
    box(
      `man.valve${index}`,
      valve,
      MANIFOLD.h,
      8,
      { tone: 'hi', crease: 'lo' },
      {
        steps: 2,
        bevel: 0.4,
        inner: Ln(k.sideSeam(valve, MANIFOLD.h + 3, P, 2), { tone: 'faint' }),
        extra: Dots([at([cx - 3, VY + 1.6, VALVE_TOP]), at([cx + 3, VY + 1.6, VALVE_TOP])], {
          size: 0.4,
          tone: 'lo',
        }),
      },
    );
    const CF = G.frameOf(
      [cx + 5, VY + valve.d / 2, MANIFOLD.h + 4],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    );
    turned(
      `man.coil${index}`,
      CF,
      [
        [0, 2.8],
        [6, 2.8],
        [6, 2.2],
        [7.6, 2.2],
      ],
      { tone: 'mid' },
      { inner: Ln(G.arcOf(CF, 3, 2.8, P), { tone: 'faint' }) },
    );
    disc(
      `man.port${index}`,
      ZF(cx - 1.5, VY + valve.d / 2, VALVE_TOP),
      0,
      2.2,
      2,
      { tone: 'mid' },
      { bias: 0.02 },
    );
  });
  {
    const FX = MANIFOLD.x - 26;
    const FY = MANIFOLD.y + MANIFOLD.d / 2;
    box(
      'frl.body',
      { x: FX - 6, y: FY - 6, w: 12, d: 12, r: 1.5 },
      14,
      10,
      { tone: 'mid' },
      { steps: 3, bevel: 0.5 },
    );
    turned(
      'frl.bowl',
      G.frameOf([FX, FY, 14], [0, 0, -1], [1, 0, 0], [0, 1, 0]),
      [
        [0, 4.6],
        [2, 4.6],
        [3, 4.2, 1],
        [8, 4, 1],
        [11, 3, 1],
        [12.6, 1.6, 1],
        [13, 0.6],
      ],
      { tone: 'hi' },
    );
    box(
      'frl.stand',
      { x: FX - 1.6, y: FY + 6, w: 3.2, d: 2, r: 0.4 },
      0,
      24,
      { tone: 'mid' },
      { steps: 2 },
    );
    const GF = ZF(FX, FY, 24);
    disc(
      'frl.gauge',
      GF,
      0,
      2.2,
      4.4,
      { tone: 'hi' },
      {
        extra:
          Ln(k.ring(FX, FY, 3.2, 26.2, P, 24), { tone: 'lo' }) +
          Ln(k.lineOnTop([FX, FY], [FX + 2.4, FY - 1.4], 26.3, P), { tone: 'lit', free: 'end' }),
      },
    );
    const route = [
      [FX + 6, FY, 19],
      [MANIFOLD.x - 8, FY, 19],
      [MANIFOLD.x - 8, FY, 5],
      [MANIFOLD.x, FY, 5],
    ];
    const filleted = G.fillet(route, 4.4, 10, { P, tube: 1.4 });
    R.route('air.supply', filleted, 1.4, { piece: 'line', touch: ['frl.body', 'man.block'] });
    tubePieces(filleted, 1.4, P, { maxLength: 12 }).forEach((piece, i) =>
      put(
        `air.supply:${i}`,
        piece.mid,
        tubeSvg(piece, { tone: 'mid' }),
        [A.tube(piece.points, piece.radii)],
        { bias: 0.05 },
      ),
    );
  }

  // ---------------------------------------------------------------- moving parts built once
  const chipSvg = (lit = false) => {
    const plan = { x: -CW / 2 + 0.3, y: CHIP_Y - CHIP.d / 2, w: CW - 0.6, d: CHIP.d, r: 0.6 };
    const z = BELT.top;
    const pad = k.insetPlan(plan, 2);
    const pins = [-3.2, -1.1, 1.1, 3.2].flatMap((dx) => [
      at([dx, plan.y + 0.6, z + CHIP.h]),
      at([dx, plan.y + plan.d - 0.6, z + CHIP.h]),
    ]);
    return (
      S(k.slabOf(plan, z, CHIP.h, P, 2, 0.3), { tone: 'hi', crease: 'lo', lit }) +
      Ln(k.planOutline(pad, z + CHIP.h, P, 2), { tone: 'lo' }) +
      Dots(pins, { size: 0.35, tone: 'mid' }) +
      Dots([at([-1.6, plan.y + 2.8, z + CHIP.h])], { size: 0.45, tone: 'lo' })
    );
  };
  // a bar of N chips before it is cut, with its cut lines (hidden until each cut)
  const barSvg = (n) => {
    const len = n * CW;
    const plan = { x: -len / 2, y: CHIP_Y - CHIP.d / 2, w: len, d: CHIP.d, r: 0.6 };
    const z = BELT.top;
    const scribes = Array.from(
      { length: n - 1 },
      (_, i) => `<path class="ln-cut" data-cut="${i + 1}" d="" style="display:none"/>`,
    ).join('');
    const pads = Array.from({ length: n }, (_, i) =>
      Ln(
        k.planOutline(
          k.insetPlan({ x: -len / 2 + i * CW + 0.3, y: plan.y, w: CW - 0.6, d: CHIP.d, r: 0.6 }, 2),
          z + CHIP.h,
          P,
          2,
        ),
        { tone: 'faint' },
      ),
    ).join('');
    return (
      S(k.slabOf(plan, z, CHIP.h, P, 2, 0.3), { tone: 'hi', crease: 'lo', lit: true }) +
      pads +
      scribes
    );
  };
  const MAX_N = Math.max(...STORY.steps.map((s) => s.chips.length));
  const chips = Array.from(
    { length: MAX_N },
    (_, i) => `<g data-chip="${i}" style="display:none">${chipSvg()}</g>`,
  ).join('');
  const bars = STORY.steps
    .map((s, i) => {
      const n = s.chips.length;
      return `<g data-bar="${i}" data-n="${n}">${barSvg(n)}</g>`;
    })
    .join('');

  // ---------------------------------------------------------------- order and slots
  const CARRIAGE_SVG = `<g data-part="saw-head"><g data-part="saw-slide">${HEAD.slide}</g>${HEAD.carriage}</g>`;
  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  const indexOf = (name) => {
    const i = R.items.findIndex((item) => item.name === name);
    if (i < 0) throw new Error(`no item ${name}`);
    return i;
  };
  const slots = new Map();
  const add = (index, svg) => slots.set(index, (slots.get(index) ?? '') + svg);
  const beltAfter = Math.max(
    indexOf('conv.belt'),
    indexOf('conv.railF'),
    indexOf('conv.railB'),
    ...XS.map((_, i) => indexOf(`st${i}.rod`)),
    indexOf('mag.guideB'),
  );
  add(beltAfter, `<g data-part="on-belt"></g>`);
  {
    const magFront = indexOf('mag.guideF');
    const magIn = Math.max(indexOf('mag.lift'), indexOf('mag.guideB'), indexOf('mag.floor'));
    if (magIn > magFront) console.warn('magazine front guide drawn before its contents');
    add(Math.min(magIn, magFront - 1), `<g data-part="in-mag"></g>`);
  }
  add(Math.max(indexOf('saw.arm'), beltAfter), CARRIAGE_SVG);
  const stackOf = (i) =>
    Array.from(
      { length: 4 },
      (_, j) =>
        `<g data-stack="${i}-${j}" style="display:none" transform="${k.translateAlong(P, [XS[i], (BIN.y0 + BIN.y1) / 2 - CHIP_Y, 1.6 + j * CHIP.h - BELT.top])}">${chipSvg()}</g>`,
    ).join('');
  XS.forEach((_, i) => {
    const front = indexOf(`st${i}.binFront`);
    const inside = Math.max(
      indexOf(`st${i}.binBack`),
      indexOf(`st${i}.binL`),
      indexOf(`st${i}.binR`),
      indexOf(`st${i}.binFloor`),
    );
    const chute = Math.max(indexOf(`st${i}.chute`), indexOf(`st${i}.lipL`), indexOf(`st${i}.lipR`));
    if (inside > front) console.warn(`station ${i}: bin front drawn before its walls`);
    add(chute, `<g data-chute="${i}"></g>`);
    add(front - 1, `<g data-drop="${i}">${stackOf(i)}</g>`);
  });
  const groups = R.items.map(
    (item, index) =>
      `<g class="it" data-name="${item.name}">${item.svg}</g>${slots.get(index) ?? ''}`,
  );

  const names = andList(STORY.members.map((m) => m.name));
  const LABEL_TEXT = `A small production line on a bench that splits Expenses. On the left, a magazine holds ${word(STORY.steps.length)} bars, one per Expense; each bar is as many chips long as the Expense has shares. A conveyor carries the bar under a dicing saw on a column, which cuts it into separate chips. Further along, ${word(STORY.members.length)} pneumatic pushers, fed by air lines from a manifold, kick each chip off the belt down a chute into the bin of the member it belongs to: ${names}. Each bin's counter shows that member's balance, and a lamp marks who paid.`;
  const svg = k.figureSvg({
    width: W,
    height: H,
    label: LABEL_TEXT,
    body: [
      ...back,
      `<g class="ln-line">${groups.join('')}</g>`,
      `<g data-part="store" style="display:none">${chips}${bars}</g>`,
    ],
  });

  // ---------------------------------------------------------------- live data: the chips each Expense is cut into
  const STEPS = STORY.steps.map((s) => ({
    title: s.title,
    amountMinor: s.amountMinor,
    paidBy: IDS.indexOf(s.paidBy),
    method: s.method,
    shares: s.between.map((b) => b.shares ?? 1),
    chips: s.chips.map((c) => ({ to: IDS.indexOf(c.to), amountMinor: c.amountMinor })),
    after: IDS.map((id) => s.after[id]),
  }));
  const DATA = {
    P,
    names: STORY.members.map((m) => m.name),
    steps: STEPS,
    xs: XS,
    cw: CW,
    chip: { y: CHIP_Y, d: CHIP.d, h: CHIP.h },
    belt: { x0: BELT.x0, x1: BELT.x1, y0: BELT.y0, y1: BELT.y1, top: BELT.top },
    blade: BLADE_X,
    mag: MAG_X,
    loadX: BELT.x0 + 26,
    push: PUSH,
    bin: { y0: BIN.y0, y1: BIN.y1, h: BIN.h },
    chute: { yA: BELT.y1 + RAIL_D, yB: BIN.y0 + 1.6, zA: BELT.top - 0.4, zB: BIN.h + 1.4 },
    armZ: ARM_Z,
  };
  const CSS = `
  .iso{--ln-pos:#3dca96;--ln-neg:#f07162;--ln-glass:#070707;--ln-text:#e6e6e6;--ln-accent:#9aa6ff;--ln-lamp:#ffd27a;--ln-lamp-off:#1a1a1a;--ln-cut:#050505}
  .iso[data-theme="light"]{--ln-pos:#3dca96;--ln-neg:#f07162;--ln-glass:#1c2030;--ln-text:#f0f2f8;--ln-accent:#9aa6ff;--ln-lamp:#f5b83d;--ln-lamp-off:#e5e5e2;--ln-cut:#2a2d38}
  .ln-glass{fill:var(--ln-glass)}
  .ln-screen{font-family:"IBM Plex Mono",var(--anatomy-mono);font-weight:600;fill:var(--ln-text)}
  .ln-screen[data-line="0"]{fill:var(--ln-accent)}
  .ln-digits{font-family:"IBM Plex Mono",var(--anatomy-mono);font-weight:600;fill:var(--ln-text)}
  .ln-digits[data-sign="pos"]{fill:var(--ln-pos)}
  .ln-digits[data-sign="neg"]{fill:var(--ln-neg)}
  .ln-cut{fill:none;stroke:var(--ln-cut);stroke-width:.7;stroke-linecap:round}
  .ln-paylamp{fill:var(--ln-lamp-off);transition:fill .3s}
  .ln-paylamp[data-on]{fill:var(--ln-lamp)}
  .ln-lamp{fill:var(--ln-lamp-off);opacity:.85;transition:fill .3s}
  .ln-lamp[data-on]{fill:var(--ln-lamp)}
  `;
  // The words around the drawing: the plate's readout before the tour runs, the legend and the
  // description of the still the tour shows under reduced motion (and the link preview shows).
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const signed = (minor) =>
    minor === 0 ? '0' : `${minor > 0 ? '+' : '−'}${inr.format(Math.abs(minor) / 100)}`;
  const lastStep = STORY.steps.at(-1);
  const payer = STORY.members.find((m) => m.id === lastStep.paidBy).name;
  const stillCounters = STORY.members.map(
    (m) => STORY.steps.at(-2).after[m.id] + (m.id === lastStep.paidBy ? lastStep.amountMinor : 0),
  );
  const STILL_TEXT = `A small production line that splits Expenses. A saw cuts each Expense bar into one chip per share, and pneumatic pushers send each chip down a chute into its member's bin. While ${lastStep.title} ₹${inr.format(lastStep.amountMinor / 100)}, paid by ${payer}, is being sorted, the bins for ${names} read ${andList(stillCounters.map(signed))}.`;
  return {
    id: 'splitting-line',
    number: 1,
    title: 'The splitting line',
    label: LABEL_TEXT,
    readout: `Line idle · ${STORY.steps.length} Expenses waiting`,
    legend: [
      { mark: 'bin', label: `Bins, left to right: ${names}` },
      { mark: 'positive', label: '+ gets back' },
      { mark: 'negative', label: '− owes' },
      { mark: 'lamp', label: 'Lamp: who paid' },
    ],
    caption: 'Each Expense is cut into one chip per share, and the counters always add up to zero.',
    // The poses the tour shows under reduced motion, stepping from its still: every Expense split,
    // the finished line, the idle line, then each Expense before the last.
    poses: STORY.steps.length + 2,
    still: STILL_TEXT,
    width: W,
    height: H,
    svg,
    css: CSS,
    tour: DATA,
    recorder: R,
    projection: P,
  };
}
