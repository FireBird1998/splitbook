// Shared parts and helpers for the landing figures built on them (Figs 2 and 3), so every plate
// reads as one factory: the projection, the recorder the audit reads, solids, a recessed screen,
// routed tubes, the bench every figure stands on, and the chips and bars of the story.
import * as k from '../../vendor/anatomy/kit/iso-kit.mjs';
import * as G from '../../vendor/anatomy/kit/lathe.mjs';
import * as A from '../../vendor/anatomy/kit/audit.mjs';
import { tubePieces, tubeSvg } from '../../vendor/anatomy/kit/tube.mjs';

export { k, G, A, tubePieces, tubeSvg };

export function setup({ W, H, points, azimuth = 60, elevation = 30, pad = 24, piece = 'fig' }) {
  const P = k.fitProjection(points, W, H, { pad, azimuth, elevation });
  const KS = G.scaleOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dots = (points, style) => k.dotsSvg(points, style);
  const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
  const R = A.recorder(P);
  const record = R.solid;
  const put = (name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) =>
    R.put({ name, at: ref, bias, svg, shapes, piece, ...rest });
  const box = (
    name,
    plan,
    z0,
    h,
    style = {},
    { steps = 4, bevel = 0, extra = '', inner = '', bias = 0, ref, owner } = {},
  ) => {
    const shape = record(A.slab(plan, z0, h, { name, owner }, steps));
    put(
      name,
      ref ?? [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + h / 2],
      S(k.slabOf(plan, z0, h, P, steps, bevel), { tone: 'mid', ...style, inner }) + extra,
      [shape],
      { bias },
    );
    return shape;
  };
  const post = (
    name,
    cx,
    cy,
    r,
    z0,
    h,
    style = {},
    { extra = '', inner = '', bias = 0, steps = 24, owner } = {},
  ) => {
    const shape = record(A.cylinder(cx, cy, r, z0, h, { name, owner }));
    put(
      name,
      [cx, cy, z0 + h / 2],
      S(k.cylinder(cx, cy, r, z0, h, P, steps), { tone: 'mid', ...style, inner }) + extra,
      [shape],
      { bias },
    );
    return shape;
  };
  const turned = (
    name,
    F,
    profile,
    style = {},
    { extra = '', inner = '', bias = 0, owner, ref } = {},
  ) => {
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
  };
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
  const prism = (name, F, poly, s0, s1, style = {}, { extra = '', bias = 0, ref, owner } = {}) => {
    const shape = record(A.prism(F, poly, s0, s1, { name, owner }));
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
  };
  const planeMatrix = (o, ex, ey) => {
    const p0 = at(o);
    const px = at(G.add3(o, ex));
    const py = at(G.add3(o, ey));
    const v = (x) => x.toFixed(4);
    return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
  };
  // a recessed window on a face that points +y; content is drawn in the face plane (u right, w down from the top edge)
  const faceWindow = (id, y, u0, u1, z0, z1, depth, content, glass = 'fg-glass') => {
    const f = (u, z, off = 0) => [u, y - off, z];
    const outer = path3([f(u0, z0), f(u1, z0), f(u1, z1), f(u0, z1)], true);
    const backFace = path3(
      [f(u0, z0, depth), f(u1, z0, depth), f(u1, z1, depth), f(u0, z1, depth)],
      true,
    );
    const floor = path3([f(u0, z0), f(u1, z0), f(u1, z0, depth), f(u0, z0, depth)], true);
    const side = path3([f(u0, z0), f(u0, z1), f(u0, z1, depth), f(u0, z0, depth)], true);
    return `<clipPath id="${id}"><path d="${outer}"/></clipPath><g clip-path="url(#${id})"><path class="${glass}" d="${backFace}"/><path class="iso-shade" data-shade="1" d="${floor}"/><path class="iso-shade" data-shade="2" d="${side}"/><g transform="${planeMatrix(f(u0, z1, depth), [1, 0, 0], [0, 0, -1])}">${content}</g></g><path class="iso-line" data-tone="lo" d="${outer}"/>`;
  };
  const XF = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const YF = (x, y, z) => G.frameOf([x, y, z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const ZF = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  // arc length along a polyline nearest to a point (to gap a pipe under a clamp)
  const arcNear = (points, p) => {
    let best = 0;
    let bestD = Infinity;
    let run = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const seg = G.sub3(b, a);
      const len = G.len3(seg);
      const t = Math.max(0, Math.min(1, G.dot3(G.sub3(p, a), seg) / (len * len || 1)));
      const d = G.len3(G.sub3(G.add3(a, G.mul3(seg, t)), p));
      if (d < bestD) {
        bestD = d;
        best = run + t * len;
      }
      run += len;
    }
    return best;
  };
  const route = (
    name,
    points,
    r,
    { bend = 4.4, tone = 'mid', maxLength = 12, touch = [], limp = false, clamps = [] } = {},
  ) => {
    const filleted = G.fillet(points, bend, 10, { P, tube: r });
    const gaps = clamps.map(({ at: p, half }) => {
      const s = arcNear(filleted, p);
      return [s - half, s + half];
    });
    R.route(name, filleted, r, { piece, touch, limp, gaps });
    tubePieces(filleted, r, P, { maxLength, gaps }).forEach((pc, i) =>
      put(`${name}:${i}`, pc.mid, tubeSvg(pc, { tone }), [A.tube(pc.points, pc.radii)], {
        bias: 0.05,
      }),
    );
    return filleted;
  };
  // the bench every figure stands on: plate on feet, groove, corner screws, a ruler strip
  const base = (PLATE, { plateH = 12, footH = 5, strip, label } = {}) => {
    const back = [];
    back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -plateH - footH, plateH, P)}"/>`);
    const byDepth = (pts) =>
      [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
    for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
      back.push(S(k.cylinder(x, y, 7, -plateH - footH, 1.6, P, 28), { tone: 'lo' }));
      back.push(
        S(k.cylinder(x, y, 5.4, -plateH - footH + 1.6, footH - 1.6, P, 28), { tone: 'mid' }),
      );
    }
    back.push(
      S(k.slabOf(PLATE, -plateH, plateH, P, 8, 1.6), {
        tone: 'mid',
        inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: 'faint' }),
      }),
    );
    back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: 'lo' }));
    const screws = k.corners(PLATE, 10);
    back.push(Ln(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(''), { tone: 'lo' }));
    back.push(
      Dots(
        screws.map(([x, y]) => at([x, y, 0])),
        { size: 0.5 },
      ),
    );
    record(A.slab(PLATE, -plateH, plateH, { name: 'stand.plate', ground: true }, 8));
    if (strip) {
      back.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: 'lo', crease: 'none' }));
      const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y, 0.6, [1.6, 3], P);
      back.push(Ln(t.minor, { tone: 'lo' }), Ln(t.major, { tone: 'mid' }));
      back.push(
        Dots(
          [
            at([strip.x + 2, strip.y + strip.d / 2, 0.6]),
            at([strip.x + strip.w - 2, strip.y + strip.d / 2, 0.6]),
          ],
          { size: 0.45 },
        ),
      );
    }
    if (label) {
      back.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: 'lo' }));
      back.push(Ln(k.planOutline(k.insetPlan(label, 1.6), 0.8, P, 4), { tone: 'faint' }));
      back.push(
        Ln(
          [
            [label.x + 7, label.y + 4.8, 30],
            [label.x + 7, label.y + 7.5, 22],
            [label.x + 7, label.y + 10.2, 26],
          ]
            .map(([x, yy, len]) => k.lineOnTop([x, yy], [x + len, yy], 0.8, P))
            .join(''),
          { tone: 'lo', free: true },
        ),
      );
      back.push(
        Dots(
          [
            at([label.x + 3.4, label.y + 7.5, 0.8]),
            at([label.x + label.w - 3.4, label.y + 7.5, 0.8]),
          ],
          { size: 0.45 },
        ),
      );
    }
    return back;
  };
  // a chip, built at x = 0 centred on y = cy, standing on z
  const chipSvg = ({ cw = 12, d = 14, h = 3, cy = 0, z = 0, lit = false, tag = false } = {}) => {
    const plan = { x: -cw / 2 + 0.3, y: cy - d / 2, w: cw - 0.6, d, r: 0.6 };
    const pad = k.insetPlan(plan, 2);
    const pins = [-3.2, -1.1, 1.1, 3.2].flatMap((dx) => [
      at([dx, plan.y + 0.6, z + h]),
      at([dx, plan.y + plan.d - 0.6, z + h]),
    ]);
    return (
      S(k.slabOf(plan, z, h, P, 2, 0.3), { tone: 'hi', crease: 'lo', lit }) +
      Ln(k.planOutline(pad, z + h, P, 2), { tone: 'lo' }) +
      Dots(pins, { size: 0.35, tone: 'mid' }) +
      Dots([at([-1.6, plan.y + 2.8, z + h])], { size: 0.45, tone: 'lo' }) +
      (tag
        ? `<path class="fg-tag" d="${k.slabOf({ x: plan.x + 1.2, y: plan.y + plan.d - 2.6, w: plan.w - 2.4, d: 1.6, r: 0.4 }, z + h, 0.01, P, 2).fill}"/>`
        : '')
    );
  };
  // a bar of n chips before it is cut, with faint pads; tag marks a bar an assistant prepared
  const barSvg = (n, { cw = 12, d = 14, h = 3, cy = 0, z = 0, lit = true, tag = false } = {}) => {
    const len = n * cw;
    const plan = { x: -len / 2, y: cy - d / 2, w: len, d, r: 0.6 };
    const pads = Array.from({ length: n }, (_, i) =>
      Ln(
        k.planOutline(
          k.insetPlan({ x: -len / 2 + i * cw + 0.3, y: plan.y, w: cw - 0.6, d, r: 0.6 }, 2),
          z + h,
          P,
          2,
        ),
        { tone: 'faint' },
      ),
    ).join('');
    const tagSvg = tag
      ? `<path class="fg-tag" d="${k.slabOf({ x: plan.x + 1.4, y: plan.y + d - 3, w: len - 2.8, d: 1.8, r: 0.5 }, z + h, 0.01, P, 2).fill}"/>`
      : '';
    return S(k.slabOf(plan, z, h, P, 2, 0.3), { tone: 'hi', crease: 'lo', lit }) + pads + tagSvg;
  };
  return {
    P,
    KS,
    at,
    S,
    Ln,
    Dots,
    path3,
    R,
    record,
    put,
    box,
    post,
    turned,
    disc,
    prism,
    planeMatrix,
    faceWindow,
    XF,
    YF,
    ZF,
    route,
    base,
    chipSvg,
    barSvg,
  };
}

// money ink, screens, lamps and cords, the same in every figure built on these helpers
export const FIG_CSS = `
.iso{--fg-pos:#3dca96;--fg-neg:#f07162;--fg-glass:#070707;--fg-text:#e6e6e6;--fg-accent:#9aa6ff;--fg-lamp:#ffd27a;--fg-lamp-off:#1a1a1a;--fg-slot:#050505;--fg-tag:#4db4ef;--fg-cord:#6a6a6a;--fg-pay:#4db4ef}
.iso[data-theme="light"]{--fg-glass:#1c2030;--fg-text:#f0f2f8;--fg-lamp:#f5b83d;--fg-lamp-off:#e5e5e2;--fg-slot:#2a2d38;--fg-tag:#0b8fd9;--fg-cord:#8c8c90;--fg-pay:#0b8fd9}
.fg-glass{fill:var(--fg-glass)}
.fg-slot{fill:var(--fg-slot)}
.fg-tag{fill:var(--fg-tag)}
.fg-screen{font-family:"IBM Plex Mono",var(--anatomy-mono);font-weight:600;fill:var(--fg-text)}
.fg-screen[data-line="0"]{fill:var(--fg-accent)}
.fg-digits{font-family:"IBM Plex Mono",var(--anatomy-mono);font-weight:600;fill:var(--fg-text)}
.fg-digits[data-sign="pos"]{fill:var(--fg-pos)}
.fg-digits[data-sign="neg"]{fill:var(--fg-neg)}
.fg-lamp{fill:var(--fg-lamp-off);transition:fill .3s}
.fg-lamp[data-on]{fill:var(--fg-lamp)}
`;

// ---------------------------------------------------------------- words a figure is described in
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** A small count in words ("five"), or its digits past ten; capitalised to start a sentence. */
export function word(n, capital = false) {
  const text = WORDS[n] ?? String(n);
  return capital ? text[0].toUpperCase() + text.slice(1) : text;
}
/** "You, Priya, Sam and Alex". */
export const andList = (items) =>
  new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(items);
