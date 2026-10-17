// Fig 2 · The To review desk. Run from the repo root:
//   apps/web/node_modules/.bin/tsx .claude/landing-design/figures/review-desk/build.mjs [--light] [--audit]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "/Users/ankitdas/.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "/Users/ankitdas/.claude/skills/anatomy/kit/lathe.mjs";
import * as A from "/Users/ankitdas/.claude/skills/anatomy/kit/audit.mjs";
import { tubePieces, tubeSvg } from "/Users/ankitdas/.claude/skills/anatomy/kit/tube.mjs";
import { kitScript } from "/Users/ankitdas/.claude/skills/anatomy/scripts/inline-kit.mjs";
import { calculateSplitAmountsMinor } from "../../../../packages/shared/src/exact-money.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = "/Users/ankitdas/.claude/skills/anatomy/kit";
const THEME = process.argv.includes("--light") ? "light" : "dark";

// The two items Claude prepares; only the first is saved by the member.
const ITEMS = [
  { title: "Dinner at Thalassa", short: "Dinner", amountMinor: 240000, between: ["you", "priya", "sam"] },
  { title: "Cab to the airport", short: "Cab", amountMinor: 60000, between: ["you", "priya"] },
];
const SAVED = (() => {
  const item = ITEMS[0];
  const split = calculateSplitAmountsMinor("equal", item.amountMinor, item.between.map((user) => ({ user })));
  const mine = split.find((part) => part.user === "you").amountMinor;
  return { balanceMinor: item.amountMinor - mine, split: split.map((p) => p.amountMinor) };
})();

const W = 640;
const H = 400;
const P = k.fitProjection(
  [...k.boxCorners({ x: -160, y: -58, w: 330, d: 112, r: 8 }, -17, 0), [-130, -16, 96], [100, -14, 96], [70, -20, 92]],
  W,
  H,
  { pad: 24, azimuth: 58, elevation: 30 },
);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

const PLATE = { x: -160, y: -58, w: 330, d: 112, r: 8 };
const PLATE_H = 10;
const FOOT_H = 5;
const TERM = { x: -150, y: -34, w: 40, d: 44, r: 3, h: 46 };
const DESK = { x: -92, y: -30, w: 214, d: 50, r: 4, h: 26 };
const TRACK_Y = -6;
const TRACK_Z = DESK.h + 2.4;
const CAP = { r: 4.2, len: 18 };
const CAP_Z = TRACK_Z + CAP.r;
const RECEIVE_X = -66;
const WAIT_X = [-30, -6];
const GATE_X = 12;
const STAMP_X = 40;
const DIAL = { x: 100, y: -12, R: 13, z: 64, h: 7 };
const DT = DIAL.z + DIAL.h;
const MAX = 2000;

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "desk", ...rest });
}
function box(name, plan, z0, h, style = {}, { steps = 4, bevel = 0, extra = "", inner = "", bias = 0, ref, owner } = {}) {
  const shape = record(A.slab(plan, z0, h, { name, owner }, steps));
  put(name, ref ?? [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + h / 2], S(k.slabOf(plan, z0, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
function post(name, cx, cy, r, z0, h, style = {}, { extra = "", inner = "", bias = 0, steps = 24 } = {}) {
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
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}
const ZF = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const XF = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

// ---------------------------------------------------------------- base
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(PLATE, 20))) {
  back.push(S(k.cylinder(x, y, 6.4, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -3.5, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 9);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: -96, y: PLATE.y + PLATE.d - 12, w: 220, d: 5.5, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
{
  const t = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.6, 3], P);
  back.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  back.push(Dots([at([STRIP.x + 2, STRIP.y + 2.75, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 2.75, 0.6])], { size: 0.45 }));
}

// ---------------------------------------------------------------- the assistant's terminal
{
  const front = TERM.y + TERM.d;
  const WIN = { u0: TERM.x + 5, u1: TERM.x + TERM.w - 5, z0: 18, z1: 40, depth: 1.6 };
  const face = (u, z, off = 0) => [u, front - off, z];
  const quad = (pts) => path3(pts, true);
  const outer = quad([face(WIN.u0, WIN.z0), face(WIN.u1, WIN.z0), face(WIN.u1, WIN.z1), face(WIN.u0, WIN.z1)]);
  const backFace = quad([face(WIN.u0, WIN.z0, WIN.depth), face(WIN.u1, WIN.z0, WIN.depth), face(WIN.u1, WIN.z1, WIN.depth), face(WIN.u0, WIN.z1, WIN.depth)]);
  const walls = [
    { tone: 1, d: quad([face(WIN.u0, WIN.z0), face(WIN.u1, WIN.z0), face(WIN.u1, WIN.z0, WIN.depth), face(WIN.u0, WIN.z0, WIN.depth)]) },
    { tone: 2, d: quad([face(WIN.u0, WIN.z0), face(WIN.u0, WIN.z1), face(WIN.u0, WIN.z1, WIN.depth), face(WIN.u0, WIN.z0, WIN.depth)]) },
  ];
  const lines = [0, 1, 2].map((i) => `<text class="rd-screen" data-line="${i}" x="2" y="${(5.6 + i * 6.2).toFixed(1)}" font-size="4.4"></text>`).join("");
  const screen = `<clipPath id="rd-win"><path d="${outer}"/></clipPath><g clip-path="url(#rd-win)"><path class="rd-glass" d="${backFace}"/>${walls.map((q) => `<path class="iso-shade" data-shade="${q.tone}" d="${q.d}"/>`).join("")}<g transform="${planeMatrix(face(WIN.u0, WIN.z1, WIN.depth), [1, 0, 0], [0, 0, -1])}">${lines}</g></g><path class="iso-line" data-tone="lo" d="${outer}"/>`;
  const vents = Ln([0, 1, 2, 3].map((i) => k.planOutline({ x: TERM.x + 7 + i * 7, y: front - 0.01, w: 4.5, d: 0.01, r: 0 }, 0, P)).join(""), { tone: "faint" });
  const slots = [0, 1, 2, 3].map((i) => path3([[TERM.x + 7 + i * 7.4, front, 6], [TERM.x + 11 + i * 7.4, front, 6], [TERM.x + 11 + i * 7.4, front, 12], [TERM.x + 7 + i * 7.4, front, 12]], true)).join("");
  box("term.body", TERM, 0, TERM.h, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(TERM, TERM.h - 6, P, 4), { tone: "faint" }), extra: screen + Ln(slots, { tone: "lo" }) + Ln(k.planOutline(k.insetPlan(TERM, 3), TERM.h, P, 4), { tone: "faint" }) + Dots(k.corners(TERM, 3).map(([x, y]) => at([x, y, TERM.h])), { size: 0.45 }) });
  void vents;
  // keyboard ledge on the plate in front of it
  const KEY = { x: TERM.x + 2, y: front + 3, w: TERM.w - 4, d: 12, r: 1.5 };
  box("term.keys", KEY, 0, 3.2, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Ln(k.dotGrid(KEY.x + 4, KEY.y + 3, 9, 3, 3.4, 3.2, P).map(([x, y]) => `M${(x - 1).toFixed(1)} ${y.toFixed(1)}h2`).join(""), { tone: "lo", free: true }) });
  // repeater dial: what the assistant can read
  post("term.repeater.boss", TERM.x + 30, TERM.y + 12, 6.4, TERM.h, 2.4, { tone: "mid" }, { steps: 32 });
  const rx = TERM.x + 30;
  const ry = TERM.y + 12;
  const rz = TERM.h + 2.4;
  const dial = [
    S(k.cylinder(rx, ry, 6, rz, 3.4, P, 40, 0.4), { tone: "hi", crease: "lo" }),
    Ln(k.ring(rx, ry, 4.6, rz + 3.4, P, 32), { tone: "lo" }),
    `<path class="rd-sector" data-sector="rep" d=""/>`,
    `<path data-needle="rep" class="iso-line" data-tone="lit" data-free="start" d="" style="stroke-width:.8"/>`,
    Dots([at([rx, ry, rz + 3.5])], { size: 0.45, tone: "hi" }),
  ].join("");
  put("term.repeater", [rx, ry, rz + 1.7], dial, [record(A.cylinder(rx, ry, 6, rz, 3.4, { name: "term.repeater" }))]);
  // the tube's port on the lid
  turned("term.port", ZF(TERM.x + 12, TERM.y + 14, TERM.h), [[0, 5.6], [2.2, 5.6], [2.2, 4.2], [4.6, 4.2]], { tone: "mid" }, { extra: Dots(G.dotsOf(ZF(TERM.x + 12, TERM.y + 14, TERM.h), 2.2, 4.9, 6, P, { all: true }), { size: 0.4, tone: "lo" }) });
}

// ---------------------------------------------------------------- the desk, track, gate, press and ledger drawer
const deskFront = DESK.y + DESK.d;
{
  const drawer = { x0: STAMP_X - 18, x1: STAMP_X + 18, z0: 5, z1: 19 };
  const df = (x, z, off = 0) => [x, deskFront + off, z];
  const drawerFace = path3([df(drawer.x0, drawer.z0), df(drawer.x1, drawer.z0), df(drawer.x1, drawer.z1), df(drawer.x0, drawer.z1)], true);
  const pull = path3([df(STAMP_X - 6, 14), df(STAMP_X + 6, 14), df(STAMP_X + 6, 11.5), df(STAMP_X - 6, 11.5)], true);
  const holder = path3([df(STAMP_X - 10, 17.6), df(STAMP_X + 10, 17.6), df(STAMP_X + 10, 15.6), df(STAMP_X - 10, 15.6)], true);
  // the To review drawer under the track, a counter window under the dial
  const rv = { x0: -58, x1: -2 };
  const reviewFace = path3([df(rv.x0, 5), df(rv.x1, 5), df(rv.x1, 19), df(rv.x0, 19)], true);
  const WIN = { u0: DIAL.x - 13, u1: DIAL.x + 9, z0: 8, z1: 17, depth: 1.4 };
  const winOuter = path3([df(WIN.u0, WIN.z0), df(WIN.u1, WIN.z0), df(WIN.u1, WIN.z1), df(WIN.u0, WIN.z1)], true);
  const winBack = path3([df(WIN.u0, WIN.z0, -WIN.depth), df(WIN.u1, WIN.z0, -WIN.depth), df(WIN.u1, WIN.z1, -WIN.depth), df(WIN.u0, WIN.z1, -WIN.depth)], true);
  const winWalls = [path3([df(WIN.u0, WIN.z0), df(WIN.u1, WIN.z0), df(WIN.u1, WIN.z0, -WIN.depth), df(WIN.u0, WIN.z0, -WIN.depth)], true), path3([df(WIN.u0, WIN.z0), df(WIN.u0, WIN.z1), df(WIN.u0, WIN.z1, -WIN.depth), df(WIN.u0, WIN.z0, -WIN.depth)], true)];
  const counter = `<clipPath id="rd-count"><path d="${winOuter}"/></clipPath><g clip-path="url(#rd-count)"><path class="rd-glass" d="${winBack}"/><path class="iso-shade" data-shade="1" d="${winWalls[0]}"/><path class="iso-shade" data-shade="2" d="${winWalls[1]}"/><g transform="${planeMatrix(df(WIN.u0, WIN.z1, -WIN.depth), [1, 0, 0], [0, 0, -1])}"><text class="rd-digits" data-count="" x="${(WIN.u1 - WIN.u0 - 1.4).toFixed(1)}" y="7" font-size="6.4" text-anchor="end">0</text></g></g><path class="iso-line" data-tone="lo" d="${winOuter}"/>`;
  const extra = [
    Ln(drawerFace + reviewFace, { tone: "lo" }),
    Ln(pull, { tone: "mid" }),
    Ln(holder, { tone: "faint" }),
    Ln(path3([df(rv.x0 + 22, 14), df(rv.x0 + 34, 14), df(rv.x0 + 34, 11.5), df(rv.x0 + 22, 11.5)], true), { tone: "mid" }),
    counter,
    Ln(k.planOutline(k.insetPlan(DESK, 3), DESK.h, P, 4), { tone: "faint" }),
    Dots(k.corners(DESK, 3).map(([x, y]) => at([x, y, DESK.h])), { size: 0.45 }),
  ].join("");
  box("desk.body", DESK, 0, DESK.h, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(DESK, 3, P, 4), { tone: "faint" }), extra });
  // the slot into the ledger under the stamp
  const slot = { x: STAMP_X - CAP.len / 2 - 1, y: TRACK_Y - 3.4, w: CAP.len + 2, d: 6.8, r: 2 };
  put("desk.slot", [STAMP_X, TRACK_Y, DESK.h + 0.01], `<path class="rd-slot" d="${k.slabOf(slot, DESK.h, 0.01, P, 3).fill}"/>` + Ln(k.planOutline(slot, DESK.h, P, 3), { tone: "lo" }), [record(A.box([slot.x, slot.y, DESK.h], [slot.x + slot.w, slot.y + slot.d, DESK.h + 0.02], { name: "desk.slot" }))], { bias: 0.02 });
}
// track: two rails from the receiver to the stamp, split around the slot
for (const dy of [-3.4, 3.4]) {
  const y = TRACK_Y + dy + (dy < 0 ? -1.2 : 0);
  box(`track.rail${dy < 0 ? "B" : "F"}a`, { x: RECEIVE_X - 14, y, w: STAMP_X - CAP.len / 2 - 1 - (RECEIVE_X - 14), d: 1.2, r: 0.4 }, DESK.h, 2.4, { tone: "mid" }, { steps: 2 });
  box(`track.rail${dy < 0 ? "B" : "F"}b`, { x: STAMP_X + CAP.len / 2 + 1, y, w: 10, d: 1.2, r: 0.4 }, DESK.h, 2.4, { tone: "mid" }, { steps: 2 });
}
box("track.stop", { x: RECEIVE_X - 18, y: TRACK_Y - 6, w: 4, d: 12, r: 1 }, DESK.h, 6, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Dots([at([RECEIVE_X - 16, TRACK_Y, DESK.h + 6])], { size: 0.45 }) });
// the gate: a post with a bar the lever lifts
post("gate.post", GATE_X, TRACK_Y - 9, 1.8, DESK.h, 12, { tone: "mid" }, { steps: 16 });
put("gate.bar", [GATE_X, TRACK_Y - 2, DESK.h + 9], `<g data-part="gate"></g>`, [record(A.box([GATE_X - 1, TRACK_Y - 9, DESK.h + 8], [GATE_X + 1, TRACK_Y + 5, DESK.h + 10], { name: "gate.bar" }))], { bias: 0.1 });
// the press: column behind the track, arm over it, the stamp on a rod
const COLUMN = [STAMP_X, TRACK_Y - 20];
const ARM_Z = 70;
post("press.collar", COLUMN[0], COLUMN[1], 5.2, DESK.h, 3, { tone: "mid" }, { steps: 28 });
post("press.column", COLUMN[0], COLUMN[1], 3.4, DESK.h + 3, ARM_Z - DESK.h - 3, { tone: "mid", crease: "none" }, { inner: Ln([44, 58].map((z) => k.sideArc(COLUMN[0], COLUMN[1], 3.4, z, P, 16)).join(""), { tone: "faint" }) });
box("press.arm", { x: STAMP_X - 4.5, y: COLUMN[1] - 5, w: 9, d: TRACK_Y - COLUMN[1] + 10, r: 2 }, ARM_Z, 7, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: Dots([at([STAMP_X, COLUMN[1], ARM_Z + 7]), at([STAMP_X, TRACK_Y + 2, ARM_Z + 7])], { size: 0.45 }) });
put("press.guide", [STAMP_X, TRACK_Y, ARM_Z - 3], S(G.solidOf([[0, 4.4], [4, 4.4]], ZF(STAMP_X, TRACK_Y, ARM_Z - 4), P), { tone: "mid" }), [record(A.disc(ZF(STAMP_X, TRACK_Y, ARM_Z - 4), 0, 4, 4.4, { name: "press.guide" }))], { bias: 0.05 });
put("press.stamp", [STAMP_X, TRACK_Y, 50], `<g data-part="stamp"></g>`, [record(A.cylinder(STAMP_X, TRACK_Y, 8, 40, 26, { name: "press.stamp" }))], { bias: 0.2 });
put("press.lever", [STAMP_X + 10, COLUMN[1], ARM_Z + 3], `<g data-part="lever"></g>`, [record(A.disc(G.frameAlong([STAMP_X + 4.5, COLUMN[1], ARM_Z + 3.5], [1, 0, 0]), 0, 3, 2.2, { name: "press.lever" }))], { bias: 0.15 });

// ---------------------------------------------------------------- the receiver and the tube from the terminal
const RECV_TOP = 58;
const RECV_MOUTH = CAP_Z + CAP.r + 6;
turned("recv.bell", ZF(RECEIVE_X, TRACK_Y, RECV_MOUTH), [[0, 8.6], [1.4, 8.6], [1.4, 7.8], [5, 7.2, 1], [10, 5.6, 1], [14, 4.6], [RECV_TOP - RECV_MOUTH, 4.6]], { tone: "mid" }, { inner: Ln(G.arcOf(ZF(RECEIVE_X, TRACK_Y, RECV_MOUTH), 14, 4.6, P), { tone: "faint" }) });
put("recv.mouth", [RECEIVE_X, TRACK_Y, RECV_MOUTH - 0.2], `<path class="rd-slot" d="${G.circleOf(ZF(RECEIVE_X, TRACK_Y, RECV_MOUTH), 0, 7.4, P)}"/>`, [], { bias: 0.3 });
// receiver bracket from the desk's back edge
box("recv.bracket", { x: RECEIVE_X - 3, y: DESK.y + 1, w: 6, d: TRACK_Y - 4.6 - DESK.y - 1, r: 1 }, DESK.h, 4, { tone: "lo" }, { steps: 2 });
post("recv.stand", RECEIVE_X, DESK.y + 4, 2.4, DESK.h + 4, RECV_MOUTH + 6 - DESK.h - 4, { tone: "mid" }, { steps: 16 });
box("recv.strap", { x: RECEIVE_X - 2.4, y: DESK.y + 4, w: 4.8, d: TRACK_Y - 4.6 - DESK.y - 4, r: 1 }, RECV_MOUTH + 6, 2.4, { tone: "lo" }, { steps: 2 });

const PORT = [TERM.x + 12, TERM.y + 14, TERM.h + 4.6];
const ROUTE_RAW = [PORT, [PORT[0], PORT[1], 86], [PORT[0] + 14, PORT[1], 92], [RECEIVE_X - 10, TRACK_Y, 92], [RECEIVE_X, TRACK_Y, 84], [RECEIVE_X, TRACK_Y, RECV_TOP]];
const ROUTE = G.fillet(ROUTE_RAW, 10, 10, { P, tube: 3 });
const TUBE_R = 3;
{
  const total = G.pathLength(ROUTE);
  const clampAt = total * 0.48;
  const clampP = G.pointAlong(ROUTE, clampAt);
  const clampT = G.tangentAlong(ROUTE, clampAt);
  const gaps = [[clampAt - 1.6, clampAt + 1.6]];
  R.route("tube", ROUTE, TUBE_R, { piece: "desk", gaps, touch: ["tube.clamp", "term.port", "recv.bell"] });
  tubePieces(ROUTE, TUBE_R, P, { maxLength: 16, gaps }).forEach((piece, index) => put(`tube:${index}`, piece.mid, tubeSvg(piece, { tone: "hi" }), [A.tube(piece.points, piece.radii)], { bias: 0.05 }));
  const CF = G.frameAlong(clampP, clampT);
  put("tube.clamp", clampP, S(G.disc(-1.6, 1.6, 4.6, CF, P, { steps: 32 }), { tone: "mid" }), [record(A.disc(CF, -1.6, 1.6, 4.6, { name: "tube.clamp", owner: "tube" }))], { bias: 0.1 });
  // the clamp hangs from a post on the plate between terminal and desk
  const postX = clampP[0];
  const postY = clampP[1] - 8;
  post("tube.post", postX, postY, 2.6, 0, clampP[2] - 0.8, { tone: "mid", crease: "none" }, { steps: 18, inner: Ln([30, 60].map((z) => k.sideArc(postX, postY, 2.6, z, P, 12)).join(""), { tone: "faint" }) });
  box("tube.foot", { x: postX - 6, y: postY - 6, w: 12, d: 12, r: 2 }, 0, 3, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Dots(k.corners({ x: postX - 6, y: postY - 6, w: 12, d: 12, r: 2 }, 2.4).map(([x, y]) => at([x, y, 3])), { size: 0.4 }) });
  box("tube.arm", { x: postX - 1.4, y: postY, w: 2.8, d: clampP[1] - postY - 4.4, r: 0.6 }, clampP[2] - 1.4, 2.8, { tone: "mid" }, { steps: 2 });
}

// ---------------------------------------------------------------- the Balances dial, and the sense line it lends the terminal
post("dial.collar", DIAL.x, DIAL.y, 4.6, DESK.h, 3, { tone: "mid" }, { steps: 28 });
post("dial.post", DIAL.x, DIAL.y, 2.8, DESK.h + 3, DIAL.z - DESK.h - 3, { tone: "mid", crease: "none" }, { steps: 18 });
const SWEEP = (Math.PI * 3) / 4;
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
{
  const { x, y, R: Rr } = DIAL;
  const ticks = k.radialTicks(x, y, Rr - 2.4, 20, 5, DT, [1, 2.2], P, ZERO - SWEEP, SWEEP * 2);
  const arc = (from, to, r) => k.onTop(Array.from({ length: 31 }, (_, i) => { const t = from + ((to - from) * i) / 30; return [x + Math.sin(t) * r, y - Math.cos(t) * r]; }), DT, P);
  const svg = [
    S(k.cylinder(x, y, Rr, DIAL.z, DIAL.h, P, 56, 0.6), { tone: "hi", crease: "lo", inner: Ln(k.sideArc(x, y, Rr, DT - 2.6, P, 32), { tone: "faint" }) }),
    Ln(k.knurl(x, y, Rr, DT - 2.6, DT, 60, P, 0.3), { tone: "lo" }),
    Ln(k.ring(x, y, Rr - 1.8, DT, P, 48), { tone: "lo" }),
    `<path class="rd-arc" data-sign="pos" d="${arc(ZERO, ZERO + SIGN * SWEEP, Rr - 1.8)}"/><path class="rd-arc" data-sign="neg" d="${arc(ZERO, ZERO - SIGN * SWEEP, Rr - 1.8)}"/>`,
    `<path class="rd-sector" data-sector="main" d=""/>`,
    Ln(ticks.minor, { tone: "lo" }),
    Ln(ticks.major, { tone: "mid" }),
    `<path data-needle="main" class="iso-line" data-tone="lit" data-free="start" d="" style="stroke-width:1"/>`,
    Ln(k.ring(x, y, 1.3, DT + 0.2, P, 16), { tone: "mid" }),
    Dots([at([x, y, DT + 0.2])], { size: 0.5, tone: "hi" }),
  ].join("");
  put("dial", [x, y, DIAL.z + DIAL.h / 2], svg, [record(A.cylinder(x, y, Rr, DIAL.z, DIAL.h, { name: "dial" }))]);
}
// sense line: from the dial post down behind the desk to the terminal's back, the only wire the assistant has
{
  const from = [DIAL.x, DIAL.y - 2.8, DESK.h + 12];
  const route = G.fillet([from, [DIAL.x, DESK.y - 4, DESK.h + 12], [DIAL.x, DESK.y - 4, 8], [TERM.x + TERM.w + 6, DESK.y - 4, 8], [TERM.x + TERM.w + 6, TERM.y + 10, 8], [TERM.x + TERM.w, TERM.y + 10, 8]], 4, 8, { P, tube: 0.6 });
  R.route("sense", route, 0.6, { piece: "desk", limp: true, touch: ["dial.post", "term.body"] });
  tubePieces(route, 0.6, P, { maxLength: 18 }).forEach((piece, index) => put(`sense:${index}`, piece.mid, tubeSvg(piece, { tone: "lo" }), [A.tube(piece.points, piece.radii)], { bias: 0.04 }));
  put("sense.end0", from, Dots([at(from)], { size: 1.1, tone: "mid" }), [A.ball(from, 1.1 / KS, { name: "sense.end0", owner: "sense" })], { bias: 0.2 });
  const to = route[route.length - 1];
  put("sense.end1", to, Dots([at(to)], { size: 1.1, tone: "mid" }), [A.ball(to, 1.1 / KS, { name: "sense.end1", owner: "sense" })], { bias: 0.2 });
}

// ---------------------------------------------------------------- order, slots, capsules
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const indexOf = (name) => R.items.findIndex((item) => item.name === name);
const slots = new Map();
const add = (index, svg) => slots.set(index, (slots.get(index) ?? "") + svg);
const capsuleSvg = (lit) => {
  const F = XF(-CAP.len / 2, TRACK_Y, CAP_Z);
  const body = S(G.solidOf([[0, 2.6], [0.6, 3.6, 1], [1.8, CAP.r], [CAP.len - 1.8, CAP.r], [CAP.len - 0.6, 3.6, 1], [CAP.len, 2.6]], F, P), { tone: "hi", lit, inner: Ln(G.arcOf(F, 3.4, CAP.r, P) + G.arcOf(F, CAP.len - 3.4, CAP.r, P), { tone: "faint" }) });
  const band = S(G.disc(CAP.len / 2 - 1.2, CAP.len / 2 + 1.2, CAP.r + 0.5, F, P, { steps: 28 }), { tone: "mid" });
  return body + band;
};
const lastTrack = Math.max(indexOf("track.railFa"), indexOf("track.railBa"), indexOf("desk.slot"));
add(lastTrack, ITEMS.map((_, i) => `<g data-capsule="${i}" style="display:none">${capsuleSvg(i === 0)}</g>`).join(""));
const groups = R.items.map((item, index) => `<g class="it" data-name="${item.name}">${item.svg}</g>${slots.get(index) ?? ""}`);

const LABEL_TEXT =
  "A desk for To review. On the left, the assistant's terminal: a screen, a keyboard and a small repeater dial wired to the desk's Balances dial, so it can read the balance. A pneumatic tube runs from the terminal over a post to a receiver above a track on the desk. Each item the assistant prepares arrives as a capsule and waits on the track at a gate. Only the member's lever lifts the gate and brings the stamp down, which presses the capsule through a slot into the ledger drawer; then the Balances dial and its counter move. The tube ends at the receiver and never reaches the ledger.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="rd-desk">${groups.join("")}</g>`] });

const DATA = {
  P,
  items: ITEMS.map(({ title, short, amountMinor, between }) => ({ title, short, amountMinor, between: between.length })),
  saved: SAVED,
  receive: RECEIVE_X,
  wait: WAIT_X,
  gate: GATE_X,
  stamp: STAMP_X,
  trackY: TRACK_Y,
  capZ: CAP_Z,
  mouth: RECV_MOUTH,
  deskTop: DESK.h,
  armZ: ARM_Z,
  column: COLUMN,
  dial: { x: DIAL.x, y: DIAL.y, R: DIAL.R, top: DT, zero: ZERO, sign: SIGN, sweep: SWEEP, max: MAX },
  repeater: { x: TERM.x + 30, y: TERM.y + 12, R: 6, top: TERM.h + 2.4 + 3.4 },
};

const CSS = `
.rd-stage{position:relative;outline:none;touch-action:pan-y;cursor:pointer}
.rd-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso{--rd-pos:#3dca96;--rd-neg:#f07162;--rd-glass:#070707;--rd-text:#e6e6e6;--rd-accent:#7b8cff;--rd-slot:#050505}
.iso[data-theme="light"]{--rd-pos:#1a9a6e;--rd-neg:#e04f3d;--rd-glass:#1c2030;--rd-text:#f0f2f8;--rd-accent:#9aa6ff;--rd-slot:#2a2d38}
.rd-glass{fill:var(--rd-glass)}
.rd-slot{fill:var(--rd-slot)}
.rd-screen{font-family:"IBM Plex Mono",var(--anatomy-mono);font-weight:600;fill:var(--rd-text)}
.rd-screen[data-line="0"]{fill:var(--rd-accent)}
.rd-digits{font-family:"IBM Plex Mono",var(--anatomy-mono);font-weight:600;fill:var(--rd-text)}
.rd-digits[data-sign="pos"]{fill:#3dca96}
.rd-arc{fill:none;stroke-width:.9;stroke-linecap:round;opacity:.9}
.rd-arc[data-sign="pos"]{stroke:var(--rd-pos)}
.rd-arc[data-sign="neg"]{stroke:var(--rd-neg)}
.rd-sector{opacity:.32;fill:var(--rd-pos)}
.rd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600&display=swap">`;
const latheSource = readFileSync(join(KIT, "lathe.mjs"), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${latheSource}\nreturn { viewOf, scaleOf, frameAlong, frameOf, pointOf, disc, sphereOf, prismOf, circleOf, arcOf, dotsOf, solidOf, dot3, add3, sub3, mul3, unit3, cross3, len3 };})();\n`;
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const body =
  FONTS +
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 2",
    title: "The To review desk",
    hint: "Click or → for the next step",
    readout: "To review · empty",
    keys: [
      { mark: "lit", label: "The capsule waiting for you, and the needles" },
      { mark: "raised", label: "The tube ends at the receiver: an assistant can only prepare" },
      { mark: "edge", label: "Sense line: what the assistant can read, a repeater of Balances" },
    ],
    caption:
      "Claude prepares two items from a chat: Dinner at Thalassa ₹2,400, split equally between three, and Cab to the airport ₹600. Each lands in To review and waits at the gate. Only your lever lifts the gate and brings the stamp down: Dinner is saved and Balances moves to +₹1,600, since the other two owe you ₹800 each. Cab stays in To review until you save it. The assistant reads the same balance through its repeater, and its tube never reaches the ledger.",
    body: `<div class="iso-stage rd-stage" tabindex="0" role="group" aria-label="To review desk. Click, press the right arrow or space for the next step; Home starts over.">${svg}<span class="rd-sr" role="status" aria-live="polite" data-status></span></div>`,
  });
const page = k.pageHtml({ title: "The To review desk", theme: THEME, body, script: kitScript() + latheScript + LIVE, width: 700 });
writeFileSync(join(HERE, THEME === "light" ? "review-desk-light.html" : "review-desk.html"), page);
console.log("wrote", THEME, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`, "saved balance", SAVED.balanceMinor / 100);
A.auditOrExit(R, P, {});
