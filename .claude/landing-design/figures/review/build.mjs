// Fig 2 · The To review rack. Run from the repo root:
//   apps/web/node_modules/.bin/tsx .claude/landing-design/figures/review/build.mjs [--light] [--audit]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kitScript } from "/Users/ankitdas/.claude/skills/anatomy/scripts/inline-kit.mjs";
import { setup, k, G, A, FIG_CSS, FONTS } from "../common.mjs";
import { calculateSplitAmountsMinor } from "../../../../packages/shared/src/exact-money.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

// what Claude prepares from one chat message; only the first is saved
const ITEMS = [
  { title: "Dinner", amountMinor: 240000, between: ["you", "priya", "sam"] },
  { title: "Cab", amountMinor: 60000, between: ["you", "priya"] },
].map((item) => {
  const split = calculateSplitAmountsMinor("equal", item.amountMinor, item.between.map((user) => ({ user })));
  return { ...item, chips: split.map((p) => p.amountMinor) };
});

const W = 780;
const H = 440;
const PLATE = { x: -236, y: -84, w: 432, d: 140, r: 10 };
const TERM = { x: -224, y: -68, w: 44, d: 32, r: 3, h: 58 };
const RACK = { x0: -62, x1: -18, y: -20, z0: 10, top: 58 };
const CW = 12;
const CHIP_H = 3;
const BELT = { x0: -14, x1: 112, y0: -27, y1: -13, top: 10 };
const HOOD = { x: 112, y: -36, w: 46, d: 34, r: 2.5, h: 34 };
const RX = (RACK.x0 + RACK.x1) / 2;

const F = setup({
  W,
  H,
  piece: "review",
  points: [...k.boxCorners(PLATE, -17, 0), [TERM.x + 22, -50, 100], [RX, -20, 100], [HOOD.x + HOOD.w, -20, 40]],
  azimuth: 58,
});
const { P, KS, at, S, Ln, Dots, path3, R, record, put, box, post, turned, disc, faceWindow, XF, YF, ZF, route, base, barSvg } = F;

const back = base(PLATE, { strip: { x: -90, y: PLATE.y + PLATE.d - 11, w: 270, d: 5.5, r: 1 }, label: { x: -224, y: 24, w: 46, d: 15, r: 1.2 } });

// ---------------------------------------------------------------- the assistant's terminal
{
  const front = TERM.y + TERM.d;
  const lines = [0, 1, 2].map((i) => `<text class="fg-screen" data-line="${i}" x="2.4" y="${(5.4 + i * 6).toFixed(1)}" font-size="${i === 1 ? 4.8 : 4.2}"></text>`).join("");
  const screen = faceWindow("rv-term", front, TERM.x + 4, TERM.x + TERM.w - 4, 28, 52, 1.6, lines);
  const slots = [0, 1, 2, 3].map((i) => path3([[TERM.x + 8 + i * 8, front, 8], [TERM.x + 12 + i * 8, front, 8], [TERM.x + 12 + i * 8, front, 18], [TERM.x + 8 + i * 8, front, 18]], true)).join("");
  box("term.body", TERM, 0, TERM.h, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(TERM, 22, P, 4), { tone: "faint" }), extra: screen + Ln(slots, { tone: "lo" }) + Ln(k.planOutline(k.insetPlan(TERM, 3), TERM.h, P, 4), { tone: "faint" }) + Dots(k.corners(TERM, 2.6).map(([x, y]) => at([x, y, TERM.h])), { size: 0.45 }) });
  const KEY = { x: TERM.x + 2, y: front + 4, w: TERM.w - 4, d: 13, r: 1.5 };
  const keys = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) keys.push(k.planOutline({ x: KEY.x + 3 + col * 4.6, y: KEY.y + 2.4 + row * 3.6, w: 3.4, d: 2.4, r: 0.5 }, 3.2, P, 2));
  box("term.keys", KEY, 0, 3.2, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Ln(keys.join(""), { tone: "lo" }) });
  turned("term.port", ZF(TERM.x + 30, TERM.y + 14, TERM.h), [[0, 6], [2.2, 6], [2.2, 4.4], [4.6, 4.4]], { tone: "mid" }, { extra: Dots(G.dotsOf(ZF(TERM.x + 30, TERM.y + 14, TERM.h), 2.2, 5.2, 6, P, { all: true }), { size: 0.4, tone: "lo" }) });
  // status lamp: lit while the assistant is connected
  post("term.lampbase", TERM.x + 9, TERM.y + 8, 3, TERM.h, 1.4, { tone: "mid" }, { steps: 20 });
  put("term.lamp", [TERM.x + 9, TERM.y + 8, TERM.h + 3], S(G.sphereOf([TERM.x + 9, TERM.y + 8, TERM.h + 3.4], 2.4, P), { tone: "hi" }) + `<path class="fg-lamp" data-lamp="link" d="${G.sphereOf([TERM.x + 9, TERM.y + 8, TERM.h + 3.4], 2.4, P).fill}" style="opacity:.8"/>`, [record(A.ball([TERM.x + 9, TERM.y + 8, TERM.h + 3.4], 2.4, { name: "term.lamp" }))], { bias: 0.05 });
}

// ---------------------------------------------------------------- the To review rack
const RB = { x: RACK.x0 - 8, y: RACK.y - 14, w: RACK.x1 - RACK.x0 + 12, d: 28, r: 2 };
{
  // base: the gate housing, with the waiting count and your lever on its front
  const front = RB.y + RB.d;
  const digits = `<text class="fg-digits" data-count="rack" x="${(16 - 1.4).toFixed(1)}" y="5.2" font-size="4.8" text-anchor="end">0</text>`;
  const counter = faceWindow("rv-count", front, RX - 2, RX + 14, 2, 8, 1, digits);
  box("rack.base", RB, 0, RACK.z0, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(RB, 3, P, 4), { tone: "faint" }), extra: counter + Dots(k.corners(k.insetPlan(RB, 1.2), 3).map(([x, y]) => at([x, y, RACK.z0])), { size: 0.45 }) });
  const backPlate = { x: RACK.x0 - 4, y: RACK.y - 11, w: RACK.x1 - RACK.x0 + 8, d: 3, r: 0.6 };
  box("rack.back", backPlate, RACK.z0, RACK.top - RACK.z0, { tone: "mid" }, { steps: 2, inner: Ln(k.sideSeam(backPlate, 47, P, 2), { tone: "faint" }) });
  box("rack.left", { x: RACK.x0 - 4, y: RACK.y - 8, w: 4, d: 17, r: 0.6 }, RACK.z0, RACK.top - RACK.z0, { tone: "mid" }, { steps: 2 });
  const right = { x: RACK.x1, y: RACK.y - 8, w: 4, d: 17, r: 0.6 };
  const ticks = [];
  for (let i = 0; i < 10; i++) {
    const z = RACK.z0 + 8 + i * 4.2;
    ticks.push(k.segment([RACK.x1, right.y + right.d, z], [RACK.x1 + (i % 5 === 4 ? 3.2 : 1.8), right.y + right.d, z], P));
  }
  box("rack.right", right, RACK.z0 + 6, RACK.top - RACK.z0 - 6, { tone: "mid" }, { steps: 2, extra: Ln(ticks.join(""), { tone: "lo" }) });
  for (const x of [RACK.x0 - 2, RACK.x1 + 2]) post(`rack.post${x}`, x, RACK.y + 10.4, 1.4, RACK.z0, RACK.top - RACK.z0, { tone: "mid", crease: "none" }, { steps: 14 });
  const top = { x: RACK.x0 - 4, y: RACK.y - 11, w: RACK.x1 - RACK.x0 + 8, d: 23, r: 1.5 };
  box("rack.top", top, RACK.top, 4, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: Dots(k.corners(top, 2.4).map(([x, y]) => at([x, y, RACK.top + 4])), { size: 0.45 }) });
  // receiver bell where the tube lands
  const RF = ZF(RX, RACK.y, RACK.top + 4);
  turned("rack.receiver", RF, [[0, 9.4], [1.6, 9.4], [1.6, 8.4], [5, 7.2, 1], [9, 5.6, 1], [12, 4.4], [16, 4.4]], { tone: "mid" }, { inner: Ln(G.arcOf(RF, 12, 4.4, P), { tone: "faint" }) });
  // the gate across the exit slot
  put("rack.gate", [RACK.x1 + 2, RACK.y, RACK.z0 + 3], `<g data-part="gate">${S(k.slabOf({ x: RACK.x1, y: RACK.y - 8, w: 4, d: 17, r: 0.6 }, RACK.z0, 6, P, 2, 0.3), { tone: "hi", crease: "lo" })}</g>`, [record(A.slab({ x: RACK.x1, y: RACK.y - 8, w: 4, d: 17, r: 0.6 }, RACK.z0, 6, { name: "rack.gate" }, 2))], { bias: 0.1 });
  // your lever: a boss on the base front, the lever drawn live
  const LX = RACK.x0 + 2;
  disc("lever.boss", YF(LX, front, 5), 0, 1.6, 3.2, { tone: "mid" }, { bias: 0.05 });
  put("lever", [LX, front + 4, 14], `<g data-part="lever"></g>`, [record(A.disc(YF(LX, front + 1.6, 5), 0, 2.2, 2, { name: "lever" }))], { bias: 0.4 });
}

// ---------------------------------------------------------------- the tube from the terminal to the receiver
const PORT = [TERM.x + 30, TERM.y + 14, TERM.h + 4.6];
const TUBE_POST = [-130, -66];
{
  const tube = route("tube", [PORT, [PORT[0], PORT[1], 90], [RX, PORT[1], 90], [RX, RACK.y, 90], [RX, RACK.y, RACK.top + 20]], 3.2, { bend: 12, tone: "hi", maxLength: 14, touch: ["term.port", "rack.receiver", "tube.clamp"], clamps: [{ at: [TUBE_POST[0], PORT[1], 90], half: 1.8 }] });
  void tube;
  post("tube.post", TUBE_POST[0], TUBE_POST[1], 2.6, 4, 82, { tone: "mid", crease: "none" }, { steps: 18, inner: Ln([34, 60].map((z) => k.sideArc(TUBE_POST[0], TUBE_POST[1], 2.6, z, P, 12)).join(""), { tone: "faint" }) });
  box("tube.foot", { x: TUBE_POST[0] - 6, y: TUBE_POST[1] - 6, w: 12, d: 12, r: 2 }, 0, 4, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Dots(k.corners({ x: TUBE_POST[0] - 6, y: TUBE_POST[1] - 6, w: 12, d: 12, r: 2 }, 2.4).map(([x, y]) => at([x, y, 4])), { size: 0.4 }) });
  box("tube.arm", { x: TUBE_POST[0] - 1.4, y: TUBE_POST[1] + 2.2, w: 2.8, d: PORT[1] - TUBE_POST[1] - 4.8 - 2.2, r: 0.6 }, 85.4, 2.8, { tone: "mid" }, { steps: 2 });
  const CF = G.frameAlong([TUBE_POST[0], PORT[1], 90], [1, 0, 0]);
  put("tube.clamp", [TUBE_POST[0], PORT[1], 90], S(G.disc(-1.8, 1.8, 4.8, CF, P, { steps: 32 }), { tone: "mid" }), [record(A.disc(CF, -1.8, 1.8, 4.8, { name: "tube.clamp", owner: "tube" }))], { bias: 0.1 });
}

// ---------------------------------------------------------------- conveyor to the splitting line, and its hood
{
  box("belt.railB", { x: BELT.x0, y: BELT.y0 - 3, w: BELT.x1 - BELT.x0, d: 3, r: 0.8 }, 4, BELT.top - 4, { tone: "mid" }, { steps: 2, bevel: 0.3 });
  box("belt.belt", { x: BELT.x0, y: BELT.y0, w: BELT.x1 - BELT.x0, d: BELT.y1 - BELT.y0, r: 0.5 }, BELT.top - 2.4, 2.4, { tone: "lo", crease: "faint" }, { steps: 2, extra: `<g data-part="belt-marks"></g>` });
  const railF = { x: BELT.x0, y: BELT.y1, w: BELT.x1 - BELT.x0, d: 3, r: 0.8 };
  box("belt.railF", railF, 4, BELT.top - 4, { tone: "mid" }, { steps: 2, bevel: 0.3, extra: Ln(Array.from({ length: 7 }, (_, i) => k.sideRing([BELT.x0 + 10 + i * 22, BELT.y1 + 3, 7], 1, "y", P, 12)).join(""), { tone: "lo" }) });
  for (const x of [BELT.x0 + 8, 60]) {
    for (const y of [BELT.y0 - 1.5, BELT.y1 + 1.5]) post(`belt.leg${x}${y > -20 ? "F" : "B"}`, x, y, 1.4, 0, 4, { tone: "mid" }, { steps: 12 });
  }
}
{
  const front = HOOD.y + HOOD.d;
  const lines = [0, 1].map((i) => `<text class="fg-screen" data-line="${i}" data-hood="${i}" x="2" y="${(4.8 + i * 5.4).toFixed(1)}" font-size="${i === 0 ? 3.8 : 4.4}"></text>`).join("");
  const screen = faceWindow("rv-hood", front, HOOD.x + 5, HOOD.x + HOOD.w - 5, 16, 28, 1.2, lines);
  const vents = [0, 1, 2, 3, 4].map((i) => path3([[HOOD.x + 8 + i * 6.4, front, 5], [HOOD.x + 11.6 + i * 6.4, front, 5], [HOOD.x + 11.6 + i * 6.4, front, 11], [HOOD.x + 8 + i * 6.4, front, 11]], true)).join("");
  box("hood", HOOD, 0, HOOD.h, { tone: "mid" }, { steps: 4, bevel: 0.6, bias: 40, inner: Ln(k.sideSeam(HOOD, HOOD.h - 5, P, 4), { tone: "faint" }), extra: screen + Ln(vents, { tone: "lo" }) + Ln(k.planOutline(k.insetPlan(HOOD, 2.6), HOOD.h, P, 4), { tone: "faint" }) + Dots(k.corners(HOOD, 2.4).map(([x, y]) => at([x, y, HOOD.h])), { size: 0.45 }) });
  // a short duct on the hood's far side: the line continues behind the plate
  const DF = G.frameOf([HOOD.x + HOOD.w, RACK.y, 18], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  turned("hood.flange", DF, [[0, 10], [2.4, 10], [2.4, 8], [6, 8]], { tone: "mid" }, { bias: 40.5, extra: Dots(G.dotsOf(DF, 2.4, 9, 8, P, { all: true }), { size: 0.4, tone: "lo" }) });
}

{
  const HB = [HOOD.x + 12, HOOD.y, 22];
  disc("sense.hoodport", G.frameOf(HB, [0, -1, 0], [1, 0, 0], [0, 0, 1]), 0, 1.6, 1.8, { tone: "mid" });
  const TB = [TERM.x + TERM.w, TERM.y + 12, 30];
  disc("sense.termport", G.frameOf(TB, [1, 0, 0], [0, 1, 0], [0, 0, 1]), 0, 1.6, 1.8, { tone: "mid" });
  route("sense", [[HB[0], HB[1] - 1.6, HB[2]], [HB[0], -76, HB[2]], [HB[0], -76, 4], [TB[0] + 8, -76, 4], [TB[0] + 8, TB[1], 4], [TB[0] + 8, TB[1], TB[2]], [TB[0] + 1.6, TB[1], TB[2]]], 0.7, { bend: 3.6, tone: "lo", maxLength: 16, limp: true, touch: ["sense.hoodport", "sense.termport"] });
}

// ---------------------------------------------------------------- order and slots
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const indexOf = (name) => {
  const i = R.items.findIndex((item) => item.name === name);
  if (i < 0) throw new Error(`no item ${name}`);
  return i;
};
const slots = new Map();
const add = (index, svg) => slots.set(index, (slots.get(index) ?? "") + svg);
const inRack = Math.max(indexOf("rack.back"), indexOf("rack.left"), indexOf("rack.base"));
add(inRack, `<g data-part="in-rack"></g>`);
add(Math.max(indexOf("belt.belt"), indexOf("belt.railF"), indexOf("belt.railB"), indexOf("rack.base")), `<g data-part="on-belt"></g>`);
const groups = R.items.map((item, index) => `<g class="it" data-name="${item.name}">${item.svg}</g>${slots.get(index) ?? ""}`);
const bars = ITEMS.map((item, i) => `<g data-bar="${i}" style="display:none">${barSvg(item.chips.length, { cy: RACK.y, z: 0, tag: true })}</g>`).join("");

const LABEL_TEXT =
  "A To review rack on a bench. On the left, the assistant's terminal with a screen, a keyboard and a link lamp; a thin read line runs to it from the line, so it can read Balances. A pneumatic tube runs from the terminal over a post into a receiver on top of a tall rack, where the items the assistant prepares wait as bars with a blue tag, stacked one on another. At the bottom of the rack a gate holds them; only the member's lever on the rack's base lifts the gate and lets the bottom bar out onto a conveyor that carries it into a hood, on its way to the splitting line. The tube never reaches the conveyor.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="rv-desk">${groups.join("")}</g>`, `<g data-part="store" style="display:none">${bars}</g>`] });

const DATA = {
  P,
  items: ITEMS.map(({ title, amountMinor, chips }) => ({ title, amountMinor, chips })),
  rack: { x: RX, y: RACK.y, z0: RACK.z0, top: RACK.top, x1: RACK.x1 },
  belt: BELT,
  hood: HOOD,
  cw: CW,
  chipH: CHIP_H,
  lever: { x: RACK.x0 + 2, y: RB.y + RB.d + 1.6, z: 5, length: 16, r: 0.9, knob: 2.6, rest: -0.35, pulled: 0.75 },
};
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const latheSource = readFileSync("/Users/ankitdas/.claude/skills/anatomy/kit/lathe.mjs", "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${latheSource}\nreturn { frameAlong, frameOf, disc, sphereOf, add3, mul3 };})();\n`;
const body =
  FONTS +
  `<style>${FIG_CSS}</style>` +
  k.plateHtml({
    fig: "Fig 2",
    title: "The To review rack",
    hint: "Click or → for the next step",
    readout: "Claude connected · To review empty",
    keys: [
      { mark: "lit", label: "Your lever: the only way a bar leaves the rack" },
      { mark: "raised", label: "Bars with a blue tag: items an assistant prepared" },
      { mark: "edge", label: "The thin read line lets it see Balances; the tube ends at the rack, never at the line" },
    ],
    caption:
      "You ask Claude to add two things. It prepares them and sends each down the tube into To review: Dinner ₹2,400 between You, Priya and Sam (three ₹800 chips) and Cab ₹600 between You and Priya (two ₹300 chips). Nothing reaches the splitting line until you pull the lever. You save Dinner, and it rides into the line still tagged as prepared by Claude. Cab waits in the rack until you look at it.",
    body: `<div class="iso-stage fg-stage" tabindex="0" role="group" aria-label="To review rack. Click, press the right arrow or space for the next step; Home starts over.">${svg}<span class="fg-sr" role="status" aria-live="polite" data-status></span></div>`,
  });
const page = k.pageHtml({ title: "The To review rack", theme: THEME, body, script: kitScript() + latheScript + LIVE, width: 840 });
writeFileSync(join(HERE, THEME === "light" ? "review-light.html" : "review.html"), page);
console.log("wrote", THEME, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`, ITEMS.map((i) => i.chips.join("+")).join(" | "));
A.auditOrExit(R, P, {});
