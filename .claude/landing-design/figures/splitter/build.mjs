// Fig 1 · The splitting machine. Run from the repo root:
//   apps/web/node_modules/.bin/tsx .claude/landing-design/figures/splitter/build.mjs [--light] [--audit]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "/Users/ankitdas/.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "/Users/ankitdas/.claude/skills/anatomy/kit/lathe.mjs";
import * as A from "/Users/ankitdas/.claude/skills/anatomy/kit/audit.mjs";
import { kitScript } from "/Users/ankitdas/.claude/skills/anatomy/scripts/inline-kit.mjs";
import { story } from "../model.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = "/Users/ankitdas/.claude/skills/anatomy/kit";
const THEME = process.argv.includes("--light") ? "light" : "dark";
const STORY = story();

const W = 760;
const H = 480;
const AZIMUTH = 60;
const ELEVATION = 30;

// ---------------------------------------------------------------- world
const PLATE = { x: -200, y: -78, w: 400, d: 166, r: 10 };
const PLATE_H = 12;
const FOOT_H = 5;
const XS = [-114, -38, 38, 114];
const HOUSE = (cx) => ({ x: cx - 25, y: -44, w: 50, d: 48, r: 4 });
const BODY_Z = 24;
const LID_Z = 26;
const FRONT_Y = 4;
const SHAFT = { y: -30, z: 17, r: 3, x0: -170, x1: 150 };
const DIAL = { y: -12, R: 19, z: 76, h: 9 };
const DT = DIAL.z + DIAL.h;
const SLOT = (cx) => ({ x: cx + 10, y: -39.5, w: 12, d: 3, r: 1.5 });
const DROP = (cx) => [cx + 16, -38];
const GANTRY = { x: 186, y: -38, top: 118, beamH: 8 };
const CARRIAGE = { half: 13, y0: -46, y1: -30, z0: 110, z1: 134, chute: 98 };
const COIN = { r: 6.5, t: 1.6 };
const WHEEL = { x: -172, t: 4, r: 14, rim: 11 };
const PILLOW = { x: -158 };
const SETTLE = { x: 150, y: -44, w: 28, d: 48, r: 4, h: 30 };
const PIVOT = [164, -20, SETTLE.h + 4 + 3.4];
const LEVER = { length: 30, r: 1.4, knob: 3.4, rest: -0.42, pulled: 0.62 };
const RAIL = { x: -140, y: 36, w: 280, d: 7, r: 1.5, h: 3 };
const PUCK = { r: 6.5, h: 5.5 };
const SELECTOR = [-162, 44];
const MAX = 1000;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-GANTRY.x, GANTRY.y - 6, GANTRY.top + GANTRY.beamH + 22], [GANTRY.x, GANTRY.y - 6, GANTRY.top + GANTRY.beamH + 4]],
  W,
  H,
  { pad: 26, azimuth: AZIMUTH, elevation: ELEVATION },
);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

// The dial's zero points away from the viewer (up the screen); positive turns screen-right.
const ZERO = (() => {
  let best = 0;
  let low = Infinity;
  for (let i = 0; i < 720; i++) {
    const t = (i / 720) * Math.PI * 2;
    const [, sy] = at([Math.sin(t), -Math.cos(t), 0]);
    if (sy < low) { low = sy; best = t; }
  }
  return best;
})();
const SIGN = at([Math.sin(ZERO + 0.1), -Math.cos(ZERO + 0.1), 0])[0] > at([Math.sin(ZERO), -Math.cos(ZERO), 0])[0] ? 1 : -1;
const SWEEP = (Math.PI * 3) / 4;

// ---------------------------------------------------------------- recorder
const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "machine", ...rest });
}
function box(name, plan, z0, h, style = {}, { steps = 4, bevel = 0, extra = "", inner = "", bias = 0, ref } = {}) {
  const shape = record(A.slab(plan, z0, h, { name }, steps));
  put(name, ref ?? [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + h / 2], S(k.slabOf(plan, z0, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
function post(name, cx, cy, r, z0, h, style = {}, { extra = "", inner = "", bias = 0, steps = 28 } = {}) {
  const shape = record(A.cylinder(cx, cy, r, z0, h, { name }));
  put(name, [cx, cy, z0 + h / 2], S(k.cylinder(cx, cy, r, z0, h, P, steps), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, owner, ref } = {}) {
  const shape = record(A.solid(F, profile, { name, owner }));
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  put(name, ref ?? G.add3(F.o, G.mul3(F.a, mid)), S(G.solidOf(profile, F, P), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
const disc = (name, F, s0, s1, r, style, options) => turned(name, F, [[s0, r], [s1, r]], style, options);
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}
const XF = (x) => G.frameOf([x, SHAFT.y, SHAFT.z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

// ---------------------------------------------------------------- base
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: -184, y: 71, w: 368, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
{
  const t = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
  back.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  back.push(Dots([at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])], { size: 0.45 }));
}
const LABEL = { x: 100, y: 50, w: 44, d: 14, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 4), { tone: "lo" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.6), 0.8, P, 4), { tone: "faint" }));
back.push(Ln([[LABEL.x + 7, LABEL.y + 4.6, 30], [LABEL.x + 7, LABEL.y + 7, 22], [LABEL.x + 7, LABEL.y + 9.4, 26]].map(([x, y, len]) => k.lineOnTop([x, y], [x + len, y], 0.8, P)).join(""), { tone: "lo", free: true }));
back.push(Dots([at([LABEL.x + 3.4, LABEL.y + 7, 0.8]), at([LABEL.x + LABEL.w - 3.4, LABEL.y + 7, 0.8])], { size: 0.45 }));

// ---------------------------------------------------------------- stations
const stationData = [];
XS.forEach((cx, index) => {
  const id = STORY.members[index].id;
  const plan = HOUSE(cx);
  // body: a side seam just above the plinth, screws at the lid's corners
  box(`st${index}.body`, plan, 0, BODY_Z, { tone: "mid" }, { steps: 5, bevel: 0.6, inner: Ln(k.sideSeam(plan, 6, P, 5), { tone: "faint" }) });
  // the counter window on the front face: recess walls, dark glass and the digits
  const WIN = { u0: cx - 16, u1: cx + 8, z0: 8, z1: 18, depth: 1.6 };
  const face = (u, z, off = 0) => [u, FRONT_Y - off, z];
  const quad = (pts) => path3(pts, true);
  const recess = [
    { tone: 1, d: quad([face(WIN.u0, WIN.z0), face(WIN.u1, WIN.z0), face(WIN.u1, WIN.z0, WIN.depth), face(WIN.u0, WIN.z0, WIN.depth)]) },
    { tone: 2, d: quad([face(WIN.u0, WIN.z0), face(WIN.u0, WIN.z1), face(WIN.u0, WIN.z1, WIN.depth), face(WIN.u0, WIN.z0, WIN.depth)]) },
  ];
  const winOuter = quad([face(WIN.u0, WIN.z0), face(WIN.u1, WIN.z0), face(WIN.u1, WIN.z1), face(WIN.u0, WIN.z1)]);
  const winBack = quad([face(WIN.u0, WIN.z0, WIN.depth), face(WIN.u1, WIN.z0, WIN.depth), face(WIN.u1, WIN.z1, WIN.depth), face(WIN.u0, WIN.z1, WIN.depth)]);
  const digits = `<g transform="${planeMatrix(face(WIN.u0, WIN.z1, WIN.depth), [1, 0, 0], [0, 0, -1])}"><text class="sb-digits" data-count="${index}" x="${(WIN.u1 - WIN.u0 - 1.6).toFixed(2)}" y="7.6" font-size="7" text-anchor="end">0</text></g>`;
  const clipId = `sb-win-${index}`;
  const windowSvg = `<clipPath id="${clipId}"><path d="${winOuter}"/></clipPath><g clip-path="url(#${clipId})"><path class="sb-window" d="${winBack}"/>${recess.map((q) => `<path class="iso-shade" data-shade="${q.tone}" d="${q.d}"/>`).join("")}${digits}</g><path class="iso-line" data-tone="lo" d="${winOuter}"/>`;
  // the member's toggle: in this Expense (up) or not (down)
  const TOG = [cx + 17, FRONT_Y, 13];
  const TF = G.frameOf(TOG, [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const boss = S(G.disc(0, 1.4, 2.8, TF, P, { bevel: 0.2 }), { tone: "mid" });
  const leverAt = (up) => {
    const dir = G.unit3([0, 0.55, up ? 1 : -1]);
    const base = G.add3(TOG, [0, 1.4, 0]);
    const F = G.frameAlong(base, dir);
    return S(G.disc(0, 5.5, 0.8, F, P, { steps: 16 }), { tone: "hi" }) + S(G.sphereOf(G.add3(base, G.mul3(dir, 6.8)), 1.5, P, { steps: 24 }), { tone: "hi" });
  };
  const toggle = `${boss}<g class="sb-lever" data-up="">${leverAt(true)}</g><g class="sb-lever" data-down="">${leverAt(false)}</g>`;
  const leverShapes = [true, false].flatMap((up) => {
    const dir = G.unit3([0, 0.55, up ? 1 : -1]);
    const base = G.add3(TOG, [0, 1.4, 0]);
    return [record(A.disc(G.frameAlong(base, dir), 0, 5.5, 0.8, { name: `st${index}.lever${up ? 'Up' : 'Down'}`, owner: `st${index}.toggle` })), record(A.ball(G.add3(base, G.mul3(dir, 6.8)), 1.5, { name: `st${index}.knob${up ? 'Up' : 'Down'}`, owner: `st${index}.toggle` }))];
  });
  const winShape = record(A.box([WIN.u0, FRONT_Y - 0.05, WIN.z0], [WIN.u1, FRONT_Y + 0.05, WIN.z1], { name: `st${index}.window` }));
  const togShape = record(A.disc(TF, 0, 1.4, 2.8, { name: `st${index}.toggle`, owner: `st${index}.toggle` }));
  put(`st${index}.front`, [cx, FRONT_Y + 0.2, 13], `<g data-station="${index}" data-on="">${windowSvg}${toggle}</g>`, [winShape, togShape, ...leverShapes], { bias: 0.3 });
  // lid with the coin slot and corner screws
  const lid = k.insetPlan(plan, 1.2);
  const slot = SLOT(cx);
  const slotFill = `<path class="sb-slot" d="${k.slabOf(slot, LID_Z, 0.01, P, 3).fill}"/>`;
  const screws = k.corners(lid, 4.5);
  box(`st${index}.lid`, lid, BODY_Z, LID_Z - BODY_Z, { tone: "mid" }, {
    steps: 5,
    bevel: 0.5,
    extra: slotFill + Ln(k.planOutline(slot, LID_Z, P, 3), { tone: "lo" }) + Ln(k.planOutline(k.insetPlan(lid, 3), LID_Z, P, 5), { tone: "faint" }) + Ln(screws.map(([x, y]) => k.ring(x, y, 1.4, LID_Z, P, 12)).join(""), { tone: "lo" }) + Dots(screws.map(([x, y]) => at([x, y, LID_Z])), { size: 0.45 }),
  });
  // the post: collar, column with two seams, then the dial gauge on top
  post(`st${index}.collar`, cx, DIAL.y, 5, LID_Z, 3, { tone: "mid" }, { bias: 0.05 });
  post(`st${index}.post`, cx, DIAL.y, 3, LID_Z + 3, DIAL.z - LID_Z - 3, { tone: "mid", crease: "none" }, { inner: Ln([44, 60].map((z) => k.sideArc(cx, DIAL.y, 3, z, P, 16)).join(""), { tone: "faint" }), steps: 20 });
  const [x, y] = [cx, DIAL.y];
  const Rr = DIAL.R;
  const ticks = k.radialTicks(x, y, Rr - 3, 40, 10, DT, [1.3, 2.8], P, ZERO - SWEEP, SWEEP * 2);
  const zeroMark = k.lineOnTop([x + Math.sin(ZERO) * (Rr - 6.6), y - Math.cos(ZERO) * (Rr - 6.6)], [x + Math.sin(ZERO) * (Rr - 3), y - Math.cos(ZERO) * (Rr - 3)], DT, P);
  const arc = (from, to, r) => {
    const n = 40;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / n;
      return [x + Math.sin(t) * r, y - Math.cos(t) * r];
    });
    return k.onTop(pts, DT, P);
  };
  const posArc = arc(ZERO, ZERO + SIGN * SWEEP, Rr - 2.2);
  const negArc = arc(ZERO, ZERO - SIGN * SWEEP, Rr - 2.2);
  const crownY = y;
  const dialSvg = [
    S(k.cylinder(x, y, Rr, DIAL.z, DIAL.h, P, 64, 0.8), { tone: "hi", crease: "lo", inner: Ln(k.sideArc(x, y, Rr, DT - 3.4, P, 40), { tone: "faint" }) }),
    Ln(k.knurl(x, y, Rr, DT - 3.4, DT, 84, P, 0.3), { tone: "lo" }),
    Ln(k.ring(x, y, Rr - 2.2, DT, P, 64), { tone: "lo" }),
    `<path class="sb-arc" data-sign="pos" d="${posArc}"/><path class="sb-arc" data-sign="neg" d="${negArc}"/>`,
    `<path class="sb-sector" data-sector="${index}" d=""/>`,
    Ln(ticks.minor, { tone: "lo" }),
    Ln(ticks.major, { tone: "mid" }),
    Ln(zeroMark, { tone: "hi" }),
    `<path data-needle="${index}" class="iso-line" data-tone="lit" data-free="start" d="${k.lineOnTop([x, y], [x + Math.sin(ZERO) * (Rr - 4), y - Math.cos(ZERO) * (Rr - 4)], DT + 0.2, P)}" style="stroke-width:1.1"/>`,
    Ln(k.ring(x, y, 1.6, DT + 0.2, P, 16), { tone: "mid" }),
    Dots([at([x, y, DT + 0.2])], { size: 0.6, tone: "hi" }),
  ].join("");
  // crown on the +x side, as on a real indicator
  const crown = S(k.slabOf({ x: x + Rr - 0.2, y: crownY - 2.4, w: 4.4, d: 4.8, r: 1.2 }, DIAL.z + 2, 5, P, 3), { tone: "mid" }) + S(k.slabOf({ x: x + Rr + 4.2, y: crownY - 3.2, w: 2.6, d: 6.4, r: 1.2 }, DIAL.z + 1.2, 6.6, P, 3), { tone: "mid" });
  const dialShape = record(A.cylinder(x, y, Rr, DIAL.z, DIAL.h, { name: `st${index}.dial` }));
  const crownShape = record(A.slab({ x: x + Rr - 0.2, y: crownY - 3.2, w: 7, d: 6.4, r: 1.2 }, DIAL.z + 1.2, 6.6, { name: `st${index}.crown` }, 3));
  put(`st${index}.crown`, [x + Rr + 2, crownY, DIAL.z + 4], crown, [crownShape], { bias: -0.2 });
  put(`st${index}.dial`, [x, y, DIAL.z + DIAL.h / 2], dialSvg, [dialShape]);
  stationData.push({ id, cx, drop: DROP(cx) });
});

// ---------------------------------------------------------------- drive shaft, couplings, pillow block, handwheel
const gaps = [[WHEEL.x + WHEEL.t / 2 + 0.8, PILLOW.x - 5], [PILLOW.x + 5, XS[0] - 26.2]];
for (let i = 0; i < XS.length - 1; i++) gaps.push([XS[i] + 26.2, XS[i + 1] - 26.2]);
gaps.push([XS[XS.length - 1] + 26.2, SHAFT.x1]);
const couplingAt = [];
gaps.forEach(([a, b], index) => {
  const F = XF(0);
  const between = index >= 2 && index <= 4;
  if (between) {
    const mid = (a + b) / 2;
    disc(`shaft.${index}a`, F, a, mid - 2.2, SHAFT.r, { tone: "mid", crease: "none" });
    disc(`shaft.${index}b`, F, mid + 2.2, b, SHAFT.r, { tone: "mid", crease: "none" });
    disc(`coupling.${index}`, F, mid - 2.2, mid + 2.2, 6.2, { tone: "mid" }, { inner: Ln(G.arcOf(F, mid, 6.2, P), { tone: "faint" }), extra: `<g data-bolts="${couplingAt.length}"></g>` });
    couplingAt.push(mid);
  } else {
    disc(`shaft.${index}`, F, a, b, SHAFT.r, { tone: "mid", crease: "none" });
  }
});
// seals where the shaft enters each housing
XS.forEach((cx, index) => {
  const F = XF(0);
  disc(`seal.${index}l`, F, cx - 26.2, cx - 25, 4.4, { tone: "lo" }, { owner: `st${index}.body` });
  disc(`seal.${index}r`, F, cx + 25, cx + 26.2, 4.4, { tone: "lo" }, { owner: `st${index}.body` });
});
box("pillow.block", { x: PILLOW.x - 5, y: SHAFT.y - 8, w: 10, d: 16, r: 1.5 }, 0, SHAFT.z - 5.6, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Dots([at([PILLOW.x - 2.4, SHAFT.y - 6.4, SHAFT.z - 5.6]), at([PILLOW.x - 2.4, SHAFT.y + 6.4, SHAFT.z - 5.6])], { size: 0.45 }) });
disc("pillow.cap", XF(0), PILLOW.x - 5, PILLOW.x + 5, 5.6, { tone: "mid" }, { inner: Ln(G.arcOf(XF(0), PILLOW.x, 5.6, P), { tone: "faint" }), extra: Dots(G.dotsOf(XF(0), PILLOW.x + 5, 4.2, 4, P, { phase: Math.PI / 4, all: true }), { size: 0.4, tone: "lo" }) });
{
  const F = XF(0);
  const s0 = WHEEL.x - WHEEL.t / 2;
  const s1 = WHEEL.x + WHEEL.t / 2;
  const rim = S(G.ringBand(s0, s1, WHEEL.rim, WHEEL.r, F, P, { bevel: 0.3 }), { tone: "mid" });
  const web = S(G.disc(WHEEL.x - 1, WHEEL.x + 1, WHEEL.rim, F, P), { tone: "mid" });
  const hub = S(G.disc(s0 - 0.6, s1 + 0.8, 3.6, F, P), { tone: "mid" });
  const rimShape = record(A.ring(F, s0, s1, WHEEL.rim, WHEEL.r, { name: "wheel.rim", owner: "wheel" }));
  const hubShape = record(A.disc(F, s0 - 0.6, s1 + 0.8, 3.6, { name: "wheel.hub", owner: "wheel" }));
  const spokeShapes = Array.from({ length: 5 }, (_, i) => {
    const t = (i * Math.PI * 2) / 5;
    const u = [Math.cos(t), Math.sin(t)];
    const n = [-Math.sin(t), Math.cos(t)];
    const poly = [[u[0] * 3.4 - n[0] * 1.1, u[1] * 3.4 - n[1] * 1.1], [u[0] * (WHEEL.rim + 0.4) - n[0] * 1.1, u[1] * (WHEEL.rim + 0.4) - n[1] * 1.1], [u[0] * (WHEEL.rim + 0.4) + n[0] * 1.1, u[1] * (WHEEL.rim + 0.4) + n[1] * 1.1], [u[0] * 3.4 + n[0] * 1.1, u[1] * 3.4 + n[1] * 1.1]];
    return record(A.prism(F, poly, WHEEL.x - 1, WHEEL.x + 1, { name: `wheel.spoke${i}`, owner: "wheel" }));
  });
  put("wheel", [WHEEL.x, SHAFT.y, SHAFT.z], `<g data-part="spokes"></g>${rim}${web}${hub}<g data-part="crank"></g>`, [rimShape, hubShape, ...spokeShapes]);
}
box("settle.block", SETTLE, 0, SETTLE.h, { tone: "mid" }, {
  steps: 5,
  bevel: 0.6,
  inner: Ln(k.sideSeam(SETTLE, 6, P, 5), { tone: "faint" }),
  extra: Ln(k.planOutline(k.insetPlan(SETTLE, 3), SETTLE.h, P, 5), { tone: "faint" }) + Dots(k.corners(k.insetPlan(SETTLE, 1.2), 4.5).map(([x, y]) => at([x, y, SETTLE.h])), { size: 0.45 }),
});
{
  const F = G.frameOf(PIVOT, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  box("settle.bracket", { x: PIVOT[0] - 7, y: PIVOT[1] - 4, w: 14, d: 8, r: 1.2 }, SETTLE.h, 4, { tone: "mid" }, { steps: 3, bias: 0.05 });
  disc("settle.pivot", F, -7.4, 7.4, 3.4, { tone: "mid" }, { bias: 0.1, inner: Ln(G.arcOf(F, 0, 3.4, P), { tone: "faint" }) });
  put("settle.lever", G.add3(PIVOT, [8.6, 0, 14]), `<g data-part="lever"></g>`, [record(A.disc(G.frameAlong(G.add3(PIVOT, [8.6, 0, 0]), [0, 0, 1]), 0, LEVER.length, LEVER.r, { name: "settle.lever" }))], { bias: 0.2 });
}

// ---------------------------------------------------------------- gantry and carriage
for (const sx of [-1, 1]) {
  const gx = sx * GANTRY.x;
  box(`gantry.foot${sx}`, { x: gx - 7, y: GANTRY.y - 7, w: 14, d: 14, r: 2 }, 0, 5, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: Dots(k.corners({ x: gx - 7, y: GANTRY.y - 7, w: 14, d: 14, r: 2 }, 2.6).map(([x, y]) => at([x, y, 5])), { size: 0.45 }) });
  post(`gantry.post${sx}`, gx, GANTRY.y, 4.2, 5, GANTRY.top - 5, { tone: "mid", crease: "none" }, { inner: Ln([30, 70].map((z) => k.sideArc(gx, GANTRY.y, 4.2, z, P, 16)).join(""), { tone: "faint" }), steps: 20 });
}
const BEAM = { x: -GANTRY.x - 6, y: GANTRY.y - 4, w: GANTRY.x * 2 + 12, d: 8, r: 1.5 };
{
  const t = k.topTicks(BEAM.x + 10, BEAM.x + BEAM.w - 10, 4, 5, BEAM.y, GANTRY.top + GANTRY.beamH, [1.4, 2.8], P);
  box("gantry.beam", BEAM, GANTRY.top, GANTRY.beamH, { tone: "mid" }, {
    steps: 3,
    bevel: 0.5,
    inner: Ln(k.sideSeam(BEAM, GANTRY.top + 3, P, 3), { tone: "faint" }),
    extra: Ln(t.minor, { tone: "faint" }) + Ln(t.major, { tone: "lo" }) + Dots([-1, 1].map((sx) => at([sx * GANTRY.x, GANTRY.y, GANTRY.top + GANTRY.beamH])), { size: 0.5 }),
  });
}

function carriageSvg(cx) {
  const [dx, dy] = DROP(cx);
  const plan = { x: dx - CARRIAGE.half, y: CARRIAGE.y0, w: CARRIAGE.half * 2, d: CARRIAGE.y1 - CARRIAGE.y0, r: 2 };
  const hopperF = G.frameOf([dx, dy, CARRIAGE.z1], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const chuteF = G.frameOf([dx, dy, CARRIAGE.chute], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(plan, 3), GANTRY.top + GANTRY.beamH, 0.1, P)}" style="filter:blur(3px);opacity:.35"/>`);
  out.push(S(G.solidOf([[0, 4.6], [CARRIAGE.z0 - CARRIAGE.chute, 4.6]], chuteF, P), { tone: "mid", inner: Ln(G.arcOf(chuteF, 4, 4.6, P), { tone: "faint" }) }));
  out.push(S(G.ringBand(-0.8, 0, 3.2, 5.2, chuteF, P), { tone: "mid" }));
  out.push(`<path class="sb-slot" d="${G.circleOf(chuteF, -0.8, 3.2, P)}"/>`);
  out.push(S(k.slabOf(plan, CARRIAGE.z0, CARRIAGE.z1 - CARRIAGE.z0, P, 3, 0.6), { tone: "hi", crease: "lo", inner: Ln(k.sideSeam(plan, CARRIAGE.z0 + 6, P, 3), { tone: "faint" }) }));
  // rollers bolted through the front plate, and a lid line
  out.push(Ln(k.planOutline(k.insetPlan(plan, 2.4), CARRIAGE.z1, P, 3), { tone: "faint" }));
  const rollers = [dx - 8, dx + 8].map((rx) => at([rx, CARRIAGE.y1, GANTRY.top + GANTRY.beamH + 3]));
  out.push(Dots(rollers, { size: 1.1, tone: "mid" }), Dots(rollers, { size: 0.45, tone: "hi" }));
  out.push(S(G.solidOf([[0, 5.2], [3, 5.2], [10, 9.2, 1], [12, 9.6]], hopperF, P, { rims: "first" }), { tone: "mid" }));
  out.push(S(G.ringBand(12, 13.2, 7.6, 9.8, hopperF, P), { tone: "mid" }));
  out.push(`<path class="sb-slot" d="${G.circleOf(hopperF, 13.2, 7.6, P)}"/>`);
  return out.join("");
}
const CARRIAGE_SVG = `<g data-part="carriage">${carriageSvg(XS[0])}</g>`;

// ---------------------------------------------------------------- front rail, puck and split selector
box("rail", RAIL, 0, RAIL.h, { tone: "mid" }, {
  steps: 3,
  bevel: 0.4,
  extra: Ln(XS.map((x) => k.lineOnTop([x, RAIL.y], [x, RAIL.y + RAIL.d], RAIL.h, P)).join(""), { tone: "lo" }) + Ln(k.planOutline(k.insetPlan(RAIL, 1.6), RAIL.h, P, 3), { tone: "faint" }),
});
for (const sx of [RAIL.x - 5, RAIL.x + RAIL.w]) box(`rail.stop${sx}`, { x: sx, y: RAIL.y - 2, w: 5, d: RAIL.d + 4, r: 1.2 }, 0, 7, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: Dots([at([sx + 2.5, RAIL.y + RAIL.d / 2, 7])], { size: 0.45 }) });
function puckSvg(px) {
  const py = RAIL.y + RAIL.d / 2;
  return S(k.cylinder(px, py, PUCK.r, RAIL.h, PUCK.h, P, 40, 0.5), { tone: "hi", crease: "lo" }) + Ln(k.ring(px, py, PUCK.r - 2, RAIL.h + PUCK.h, P, 32), { tone: "lo" }) + Ln(k.knurl(px, py, PUCK.r, RAIL.h + 1, RAIL.h + PUCK.h - 1, 40, P, 0.3), { tone: "faint" }) + Dots([at([px, py, RAIL.h + PUCK.h])], { size: 0.6, tone: "mid" });
}
put("puck", [XS[3], RAIL.y + RAIL.d / 2, RAIL.h + PUCK.h / 2], `<g data-part="puck">${puckSvg(XS[3])}</g>`, [record(A.cylinder(XS[3], RAIL.y + RAIL.d / 2, PUCK.r, RAIL.h, PUCK.h, { name: "puck" }))], { bias: 0.5 });

const METHODS = ["equal", "shares", "exact"];
const DETENT = (i) => -0.95 + i * 0.95;
{
  const [sx, sy] = SELECTOR;
  const detents = METHODS.map((_, i) => {
    const t = DETENT(i);
    return at([sx + Math.sin(t) * 9.2, sy - Math.cos(t) * 9.2, 2.4]);
  });
  post("selector.base", sx, sy, 11, 0, 2.4, { tone: "mid" }, { steps: 44, extra: Dots(detents, { size: 0.65, tone: "mid" }) });
  post("selector.knob", sx, sy, 6.4, 2.4, 5.6, { tone: "hi" }, { steps: 36, bias: 0.05, extra: Ln(k.knurl(sx, sy, 6.4, 2.4, 8, 36, P), { tone: "lo" }) + Ln(k.ring(sx, sy, 1.3, 8, P, 16), { tone: "lo" }) + `<path data-part="pointer" class="iso-line" data-tone="hi" data-free="end" d="" style="stroke-width:.9"/>` });
}

// ---------------------------------------------------------------- order and slots
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const indexOf = (name) => R.items.findIndex((item) => item.name === name);
const slots = new Map();
const add = (index, svg) => slots.set(index, (slots.get(index) ?? "") + svg);
XS.forEach((_, i) => add(indexOf(`st${i}.lid`), `<g data-coin-slot="${i}"></g>`));
add(indexOf("gantry.beam"), CARRIAGE_SVG);
const groups = R.items.map((item, index) => `<g class="it" data-name="${item.name}">${item.svg}</g>${slots.get(index) ?? ""}`);

// the coin: a reeded edge, a lit top and the one engraved mark
function coinSvg([cx, cy], z) {
  const F = G.frameOf([cx, cy, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const body = S(G.disc(0, COIN.t, COIN.r, F, P, { bevel: 0.3 }), { tone: "hi", lit: true });
  const reeds = k.fadedSvg(G.ribsOf(F, 0.2, COIN.t - 0.2, COIN.r, 48, P, { fade: [0.1, 0.55] }), { tone: "lo" });
  const ring = Ln(k.ring(cx, cy, COIN.r - 1.2, z + COIN.t, P, 32), { tone: "mid" });
  const mark = k.faceTextSvg(k.topMatrix([cx, cy + 1.9], z + COIN.t, P, "x"), "₹", { size: 5.6, tone: "mid", anchor: "middle" });
  return body + reeds + ring + mark;
}
const COIN_TOP = CARRIAGE.chute - 1;
const coinStart = DROP(XS[0]);

const LABEL_TEXT =
  "A splitting machine on a bench: four stations in a row, one per member of a Group (You, Priya, Sam and Alex), each with a dial gauge and a counter window showing that member's balance. A carriage on the gantry above carries the Expense coin to whoever paid and drops it in their slot; a drive shaft through every station turns each dial by that member's share, so the dials always add up to zero. A lever on the right runs a puck along the front rail to settle up in the fewest payments, and every needle returns to zero.";
const svg = k.figureSvg({
  width: W,
  height: H,
  label: LABEL_TEXT,
  body: [...back, `<g class="sb-machine">${groups.join("")}</g>`, `<g data-part="coin" style="display:none">${coinSvg(coinStart, COIN_TOP)}</g>`],
});

// ---------------------------------------------------------------- live data
const DATA = {
  P,
  members: STORY.members,
  steps: STORY.steps.map((s) => ({ title: s.title, amountMinor: s.amountMinor, paidBy: s.paidBy, method: s.method, between: s.between.map((b) => b.user), shares: s.between.map((b) => b.shares ?? 1), delta: s.delta, after: s.after })),
  transfers: STORY.transfers,
  xs: XS,
  dial: { y: DIAL.y, R: DIAL.R, top: DT, zero: ZERO, sign: SIGN, sweep: SWEEP, max: MAX },
  drop: XS.map((x) => DROP(x)),
  coin: { top: COIN_TOP, land: LID_Z - COIN.t + 0.4, start: coinStart },
  carriageHome: XS[0],
  puckHome: XS[3],
  shaft: { y: SHAFT.y, z: SHAFT.z },
  couplings: couplingAt,
  wheel: WHEEL,
  pivot: PIVOT,
  lever: LEVER,
  selector: { at: SELECTOR, detents: METHODS.map((_, i) => DETENT(i)), methods: METHODS },
};

const CSS = `
.sb-stage{position:relative;outline:none;touch-action:pan-y;cursor:pointer}
.sb-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso{--sb-pos:#3dca96;--sb-neg:#f07162;--sb-pos-ink:#3dca96;--sb-neg-ink:#f07162;--sb-window:#070707;--sb-digit:#e6e6e6;--sb-slot:#050505}
.iso[data-theme="light"]{--sb-pos:#1a9a6e;--sb-neg:#e04f3d;--sb-pos-ink:#3dca96;--sb-neg-ink:#f07162;--sb-window:#1c2030;--sb-digit:#f0f2f8;--sb-slot:#2a2d38}
.sb-window{fill:var(--sb-window)}
.sb-slot{fill:var(--sb-slot)}
.sb-hole{fill:var(--anatomy-shade-0)}
.sb-digits{font-family:"IBM Plex Mono",var(--anatomy-mono);font-weight:600;fill:var(--sb-digit);letter-spacing:.02em}
.sb-digits[data-sign="pos"]{fill:var(--sb-pos-ink)}
.sb-digits[data-sign="neg"]{fill:var(--sb-neg-ink)}
.sb-arc{fill:none;stroke-width:1.1;stroke-linecap:round;opacity:.9}
.sb-arc[data-sign="pos"]{stroke:var(--sb-pos)}
.sb-arc[data-sign="neg"]{stroke:var(--sb-neg)}
.sb-sector{opacity:.32}
.sb-sector[data-sign="pos"]{fill:var(--sb-pos)}
.sb-sector[data-sign="neg"]{fill:var(--sb-neg)}
[data-station][data-on] .sb-lever[data-down],[data-station]:not([data-on]) .sb-lever[data-up]{display:none}
.sb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600&display=swap">`;

const latheSource = readFileSync(join(KIT, "lathe.mjs"), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${latheSource}\nreturn { viewOf, scaleOf, frameAlong, frameOf, pointOf, disc, sphereOf, prismOf, circleOf, arcOf, dotsOf, dot3, add3, sub3, mul3, unit3, cross3, len3 };})();\n`;
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));

const body =
  FONTS +
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "The splitting machine",
    hint: "Click or → for the next step",
    readout: "Group · all settled",
    keys: [
      { mark: "lit", label: "Needles: each member's balance, owed to them right of zero, owing left" },
      { mark: "raised", label: "Stations, left to right: You, Priya, Sam, Alex" },
      { mark: "edge", label: "Front rail: the puck makes the fewest payments that settle everyone" },
    ],
    caption:
      "Three Expenses go through Splitbook's own split code: Dinner ₹1,200 that You paid, split equally between four; Cab ₹600 that Priya paid, split between three; Groceries ₹1,000 that Sam paid, split by shares 2:1:1:1. The carriage drops each Expense on whoever paid, and the shaft turns every dial by that member's share, so the four dials always add up to zero. Settle up then needs three payments, not five: Alex pays You ₹500, Alex pays Sam ₹200, Priya pays Sam ₹100.",
    body: `<div class="iso-stage sb-stage" tabindex="0" role="group" aria-label="Splitting machine. Click, press the right arrow or space for the next step; Home starts over.">${svg}<span class="sb-sr" role="status" aria-live="polite" data-status></span></div>`,
  });

const page = k.pageHtml({ title: "The splitting machine", theme: THEME, body, script: kitScript() + latheScript + LIVE, width: 820 });
const name = THEME === "light" ? "splitter-light.html" : "splitter.html";
writeFileSync(join(HERE, name), page);
writeFileSync(join(HERE, THEME === "light" ? "splitter-light.svg" : "splitter.svg"), svg);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`, `zero ${(ZERO * 180 / Math.PI).toFixed(1)}° sign ${SIGN}`);
A.auditOrExit(R, P, {});
