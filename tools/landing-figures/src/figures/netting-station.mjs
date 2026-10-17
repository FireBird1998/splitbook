// Fig 3 · The netting station: four tills with counters and coin trays, a pegboard whose grey
// cords are the debts the Expenses left, and a netting cabinet that replaces them with the blue
// cords of the payments Splitbook works out. A magnet shuttle on an overhead beam carries ₹100
// coins until every counter reads zero. Every number comes from the story model, which uses
// Splitbook's own money code.
import { setup, k, G, A, FIG_CSS, andList, word } from './common.mjs';

export function buildNettingStation(STORY) {
  const IDS = STORY.members.map((m) => m.id);
  const NAMES = STORY.members.map((m) => m.name);
  const BAL = IDS.map((id) => STORY.steps[STORY.steps.length - 1].after[id]);
  const DEBTS = STORY.debts;
  const PAYMENTS = STORY.transfers;
  const COIN = 10000; // each coin is ₹100
  for (const p of PAYMENTS)
    if (p.amountMinor % COIN)
      throw new Error(`A payment of ${p.amountMinor} minor units is not a whole number of coins.`);
  const nameOf = (id) => NAMES[IDS.indexOf(id)];
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const rupees = (minor) => `₹${inr.format(minor / 100)}`;
  const signed = (minor) =>
    minor === 0 ? '0' : `${minor > 0 ? '+' : '−'}${inr.format(Math.abs(minor) / 100)}`;

  const W = 780;
  const H = 440;
  const PLATE = { x: -222, y: -72, w: 432, d: 134, r: 10 };
  const XS = [-118, -43, 32, 107];
  const TILL = { y: 4, d: 26, half: 17, h: 26 };
  const TRAY_Y = TILL.y + 13;
  const TRAY_TOP = TILL.h + 1.2;
  const COIN_R = 5.4;
  const COIN_T = 1.6;
  const BOARD = { x: -150, y: -16, w: 300, d: 4, z0: 28, z1: 74 };
  const PEGS = XS.map((x, i) => [x, i % 2 === 0 ? 68 : 54]);
  const GANTRY = { x: 172, y: TRAY_Y, top: 106 };
  const CAB = { x: -214, y: 22, w: 34, d: 26, r: 2.5, h: 64 };

  const F = setup({
    W,
    H,
    piece: 'settle',
    points: [
      ...k.boxCorners(PLATE, -17, 0),
      [-GANTRY.x, GANTRY.y, GANTRY.top + 10],
      [GANTRY.x, GANTRY.y, GANTRY.top + 10],
      [CAB.x, CAB.y, CAB.h + 24],
    ],
    azimuth: 60,
  });
  const {
    P,
    at,
    S,
    Ln,
    Dots,
    R,
    record,
    box,
    post,
    turned,
    planeMatrix,
    faceWindow,
    YF,
    ZF,
    base,
  } = F;

  const back = base(PLATE, { strip: { x: -150, y: PLATE.y + PLATE.d - 11, w: 330, d: 5.5, r: 1 } });

  // ---------------------------------------------------------------- the members' tills: counter, coin tray
  XS.forEach((cx, i) => {
    const plan = { x: cx - TILL.half, y: TILL.y, w: TILL.half * 2, d: TILL.d, r: 3 };
    const sign = BAL[i] > 0 ? 'pos' : BAL[i] < 0 ? 'neg' : 'zero';
    const digits = `<text class="fg-digits" data-count="${i}" data-sign="${sign}" x="${(24 - 1.4).toFixed(1)}" y="6.3" font-size="5.6" text-anchor="end">${signed(BAL[i])}</text>`;
    const counter = faceWindow(
      `st-count${i}`,
      TILL.y + TILL.d,
      cx - 14,
      cx + 10,
      9,
      17,
      1.2,
      digits,
    );
    const keys = [0, 1, 2]
      .map((j) => k.sideRing([cx - 8 + j * 8, TILL.y + TILL.d, 4.4], 1.4, 'y', P, 14))
      .join('');
    box(
      `till${i}`,
      plan,
      0,
      TILL.h,
      { tone: 'mid' },
      {
        steps: 4,
        bevel: 0.6,
        inner: Ln(k.sideSeam(plan, 21, P, 4), { tone: 'faint' }),
        extra:
          counter +
          Ln(keys, { tone: 'mid' }) +
          Dots(
            k.corners(k.insetPlan(plan, 1), 3).map(([x, y]) => at([x, y, TILL.h])),
            { size: 0.45 },
          ),
      },
    );
    const TF = ZF(cx, TRAY_Y, TILL.h);
    turned(
      `tray${i}`,
      TF,
      [
        [0, 11.4],
        [1.2, 11.4],
        [1.2, 10.2],
        [0.7, 9.8],
      ],
      { tone: 'lo' },
      { bias: 0.05 },
    );
  });

  // ---------------------------------------------------------------- the pegboard of debts behind them
  {
    const face = BOARD.y + BOARD.d;
    const plan = { x: BOARD.x, y: BOARD.y, w: BOARD.w, d: BOARD.d, r: 0.8 };
    const holes = [];
    for (let x = BOARD.x + 8; x < BOARD.x + BOARD.w - 4; x += 8)
      for (let z = BOARD.z0 + 6; z < BOARD.z1 - 2; z += 8) holes.push(at([x, face, z]));
    // cords live in the board's face plane: u along x, w down from z = 0
    const M = planeMatrix([0, face + 0.05, 0], [1, 0, 0], [0, 0, -1]);
    const cord = (a, b, sag) => {
      const [x1, z1] = PEGS[a];
      const [x2, z2] = PEGS[b];
      const mx = (x1 + x2) / 2;
      const mz = Math.min(z1, z2) - sag;
      return `M${x1} ${-z1}Q${mx} ${-mz} ${x2} ${-z2}`;
    };
    const sagOf = (a, b, i) => 3 + Math.abs(a - b) * 3.2 + i * 1.6;
    const debts = DEBTS.map(
      (d, i) =>
        `<path class="st-cord" data-debt="${i}" d="${cord(IDS.indexOf(d.from), IDS.indexOf(d.to), sagOf(IDS.indexOf(d.from), IDS.indexOf(d.to), i))}"/>`,
    ).join('');
    const pays = PAYMENTS.map(
      (p, i) =>
        `<path class="st-pay" data-pay="${i}" style="opacity:0" d="${cord(IDS.indexOf(p.from), IDS.indexOf(p.to), 2 + Math.abs(IDS.indexOf(p.from) - IDS.indexOf(p.to)) * 4.4 + i * 2)}"/>`,
    ).join('');
    const pegs = PEGS.map(([x, z]) => {
      const F = YF(x, face, z);
      return S(
        G.solidOf(
          [
            [0, 1.5],
            [5, 1.5],
            [5, 2.6],
            [6.4, 2.6],
          ],
          F,
          P,
        ),
        { tone: 'hi', crease: 'lo' },
      );
    }).join('');
    box(
      'board',
      plan,
      BOARD.z0,
      BOARD.z1 - BOARD.z0,
      { tone: 'mid' },
      {
        steps: 2,
        bevel: 0.4,
        inner: Ln(k.sideSeam(plan, BOARD.z0 + 4, P, 2), { tone: 'faint' }),
        extra:
          Dots(holes, { size: 0.42, tone: 'faint' }) +
          `<g transform="${M}" class="st-cords">${debts}${pays}</g>` +
          pegs,
      },
    );
    PEGS.forEach(([x, z], i) =>
      record(A.disc(YF(x, face, z), 0, 6.4, 2.6, { name: `peg${i}`, owner: 'board' })),
    );
    for (const x of [BOARD.x + 14, BOARD.x + BOARD.w - 14]) {
      post(
        `board.leg${x}`,
        x,
        BOARD.y + BOARD.d / 2,
        1.8,
        3,
        BOARD.z0 - 3,
        { tone: 'mid' },
        { steps: 14 },
      );
      box(
        `board.foot${x}`,
        { x: x - 5, y: BOARD.y - 3, w: 10, d: 10, r: 1.4 },
        0,
        3,
        { tone: 'mid' },
        { steps: 2, bevel: 0.3 },
      );
    }
  }

  // ---------------------------------------------------------------- the netting cabinet
  {
    const IDLE = ['NETTING', `${DEBTS.length} debts`, `${NAMES.length} people`];
    const lines = [0, 1, 2]
      .map(
        (i) =>
          `<text class="fg-screen" data-line="${i}" x="2.2" y="${(5 + i * 5.6).toFixed(1)}" font-size="4">${IDLE[i]}</text>`,
      )
      .join('');
    const screen = faceWindow(
      'st-screen',
      CAB.y + CAB.d,
      CAB.x + 4,
      CAB.x + CAB.w - 4,
      36,
      56,
      1.4,
      lines,
    );
    const slots = [0, 1, 2]
      .map((i) =>
        F.path3(
          [
            [CAB.x + 7 + i * 8, CAB.y + CAB.d, 10],
            [CAB.x + 11 + i * 8, CAB.y + CAB.d, 10],
            [CAB.x + 11 + i * 8, CAB.y + CAB.d, 28],
            [CAB.x + 7 + i * 8, CAB.y + CAB.d, 28],
          ],
          true,
        ),
      )
      .join('');
    box(
      'cab',
      CAB,
      0,
      CAB.h,
      { tone: 'mid' },
      {
        steps: 4,
        bevel: 0.6,
        inner: Ln(k.sideSeam(CAB, 34, P, 4), { tone: 'faint' }),
        extra:
          screen +
          Ln(slots, { tone: 'lo' }) +
          Ln(k.planOutline(k.insetPlan(CAB, 2.6), CAB.h, P, 4), { tone: 'faint' }) +
          Dots(
            k.corners(CAB, 2.4).map(([x, y]) => at([x, y, CAB.h])),
            { size: 0.45 },
          ),
      },
    );
    const LX = CAB.x + CAB.w - 8;
    const LY = CAB.y + 7;
    post('cab.pole', LX, LY, 1, CAB.h, 8, { tone: 'mid' }, { steps: 12 });
    post(
      'cab.lamp',
      LX,
      LY,
      3.2,
      CAB.h + 8,
      4.4,
      { tone: 'hi' },
      {
        steps: 24,
        extra: `<path class="fg-lamp" data-lamp="run" d="${k.cylinder(LX, LY, 3.2, CAB.h + 8, 4.4, P, 24).fill}" style="opacity:.85"/>`,
      },
    );
    post('cab.cap', LX, LY, 2.2, CAB.h + 12.4, 1.4, { tone: 'mid' }, { steps: 18 });
  }

  // ---------------------------------------------------------------- the shuttle gantry over the tills
  for (const sx of [-1, 1]) {
    const gx = sx * GANTRY.x;
    box(
      `gantry.foot${sx}`,
      { x: gx - 7, y: GANTRY.y - 7, w: 14, d: 14, r: 2 },
      0,
      4,
      { tone: 'mid' },
      {
        steps: 3,
        bevel: 0.5,
        extra: Dots(
          k
            .corners({ x: gx - 7, y: GANTRY.y - 7, w: 14, d: 14, r: 2 }, 2.6)
            .map(([x, y]) => at([x, y, 4])),
          { size: 0.45 },
        ),
      },
    );
    post(
      `gantry.post${sx}`,
      gx,
      GANTRY.y,
      4,
      4,
      GANTRY.top - 4,
      { tone: 'mid', crease: 'none' },
      {
        steps: 20,
        inner: Ln([36, 72].map((z) => k.sideArc(gx, GANTRY.y, 4, z, P, 16)).join(''), {
          tone: 'faint',
        }),
      },
    );
  }
  const BEAM = { x: -GANTRY.x - 6, y: GANTRY.y - 4, w: GANTRY.x * 2 + 12, d: 8, r: 1.5 };
  {
    const t = k.topTicks(
      BEAM.x + 10,
      BEAM.x + BEAM.w - 10,
      4,
      5,
      BEAM.y,
      GANTRY.top + 8,
      [1.4, 2.8],
      P,
    );
    box(
      'gantry.beam',
      BEAM,
      GANTRY.top,
      8,
      { tone: 'mid' },
      {
        steps: 3,
        bevel: 0.5,
        inner: Ln(k.sideSeam(BEAM, GANTRY.top + 3, P, 3), { tone: 'faint' }),
        extra: Ln(t.minor, { tone: 'faint' }) + Ln(t.major, { tone: 'lo' }),
      },
    );
  }
  // the moving shuttle: carriage, a rod and an electromagnet, built over the first till
  const ROD_TOP = GANTRY.top - 6;
  const MAG_REST = 74;
  function shuttleSvg() {
    const cx = XS[0];
    const carriage = { x: cx - 11, y: GANTRY.y - 7, w: 22, d: 14, r: 2 };
    const RF = G.frameOf([cx, GANTRY.y, ROD_TOP], [0, 0, -1], [1, 0, 0], [0, 1, 0]);
    const ROD = G.rodOut(RF, 0, ROD_TOP - MAG_REST - 3, 1.3, P, { stroke: 60 });
    const MF = ZF(cx, GANTRY.y, MAG_REST);
    const magnet =
      S(
        G.solidOf(
          [
            [0, 6.4],
            [2.4, 6.4],
            [2.4, 5],
            [3, 3.2],
            [3.6, 1.6],
          ],
          MF,
          P,
        ),
        { tone: 'hi', crease: 'lo' },
      ) + Ln(G.arcOf(MF, 1.2, 6.4, P), { tone: 'faint' });
    return {
      hanger: `<clipPath id="st-rod"><path data-hold d="${ROD.clip}"/></clipPath><g clip-path="url(#st-rod)">${S(ROD.paths, { tone: 'mid' })}</g><g data-part="magnet">${magnet}</g>`,
      carriage:
        `<path class="iso-halo" d="${k.haloOf(k.insetPlan(carriage, 3), GANTRY.top + 8, 0.1, P)}" style="filter:blur(3px);opacity:.35"/>` +
        S(k.slabOf(carriage, GANTRY.top - 6, 20, P, 3, 0.6), {
          tone: 'hi',
          crease: 'lo',
          inner: Ln(k.sideSeam(carriage, GANTRY.top + 4, P, 3), { tone: 'faint' }),
        }) +
        Dots(
          [
            at([cx - 6, carriage.y + carriage.d, GANTRY.top + 9]),
            at([cx + 6, carriage.y + carriage.d, GANTRY.top + 9]),
          ],
          { size: 1, tone: 'mid' },
        ),
    };
  }
  const SHUTTLE = shuttleSvg();

  // ---------------------------------------------------------------- order, slots, coins
  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  const indexOf = (name) => {
    const i = R.items.findIndex((item) => item.name === name);
    if (i < 0) throw new Error(`no item ${name}`);
    return i;
  };
  const late = Math.max(
    ...R.items.map((item, i) =>
      item.name.startsWith('gantry.post') || item.name.startsWith('gantry.foot') ? -1 : i,
    ),
  );
  const slots = new Map();
  const add = (index, svg) => slots.set(index, (slots.get(index) ?? '') + svg);
  const coinSvg = () => {
    const F0 = ZF(0, TRAY_Y, 0);
    return (
      S(G.disc(0, COIN_T, COIN_R, F0, P, { bevel: 0.25 }), { tone: 'hi', crease: 'lo' }) +
      k.fadedSvg(G.ribsOf(F0, 0.2, COIN_T - 0.2, COIN_R, 40, P, { fade: [0.1, 0.55] }), {
        tone: 'lo',
      }) +
      Ln(k.ring(0, TRAY_Y, COIN_R - 1, COIN_T, P, 28), { tone: 'lo' })
    );
  };
  const COINS = Math.round(BAL.filter((b) => b < 0).reduce((a, b) => a - b, 0) / COIN);
  const coins = Array.from(
    { length: COINS },
    (_, i) => `<g data-coin="${i}" style="display:none">${coinSvg()}</g>`,
  ).join('');
  add(
    indexOf('gantry.beam') > late ? indexOf('gantry.beam') : late,
    `<g data-part="coins">${coins}</g><g data-part="shuttle"><g data-part="hanger">${SHUTTLE.hanger}</g>${SHUTTLE.carriage}</g>`,
  );
  const groups = R.items.map(
    (item, index) =>
      `<g class="it" data-name="${item.name}">${item.svg}</g>${slots.get(index) ?? ''}`,
  );

  // ---------------------------------------------------------------- words
  const coinsOf = (p) => `${word(p.amountMinor / COIN)} from ${nameOf(p.from)} to ${nameOf(p.to)}`;
  const balances = andList(NAMES.map((n, i) => `${n} ${signed(BAL[i])}`));
  const LABEL_TEXT = `A netting station on a bench. ${word(NAMES.length, true)} tills stand in a row, one per member, each with a counter and a coin tray: ${balances}. Behind them a pegboard shows the ${word(DEBTS.length)} debts left by ${word(STORY.steps.length)} Expenses as cords between the members' pegs. A netting cabinet on the left replaces them with ${word(PAYMENTS.length)} payment cords, and a shuttle on an overhead beam carries ${rupees(COIN)} coins with an electromagnet: ${andList(PAYMENTS.map(coinsOf))}. Then every counter reads zero.`;
  const svg = k.figureSvg({
    width: W,
    height: H,
    label: LABEL_TEXT,
    body: [...back, `<g class="st-bench">${groups.join('')}</g>`],
  });

  const DATA = {
    P,
    names: STORY.members.map((m) => m.name),
    ids: IDS,
    balances: BAL,
    debts: DEBTS,
    payments: PAYMENTS,
    coin: COIN,
    xs: XS,
    trayTop: TRAY_TOP,
    coinT: COIN_T,
    magRest: MAG_REST,
    home: XS[0],
  };

  const CSS = `${FIG_CSS}
.st-cord{fill:none;stroke:var(--fg-cord);stroke-width:1.1;stroke-linecap:round;transition:opacity .35s}
.st-pay{fill:none;stroke:var(--fg-pay);stroke-width:1.5;stroke-linecap:round;transition:opacity .35s}
`;

  return {
    id: 'netting-station',
    number: 3,
    title: 'The netting station',
    label: LABEL_TEXT,
    readout: `${DEBTS.length} debts between ${NAMES.length} people`,
    legend: [
      { mark: 'bin', label: `Tills, left to right: ${andList(NAMES)}` },
      { mark: 'cord', label: 'Grey cords: the debts the Expenses left' },
      { mark: 'pay', label: 'Blue cords: the payments that replace them' },
      { mark: 'coin', label: `Each coin is ${rupees(COIN)}` },
    ],
    caption: `From the balances those ${word(DEBTS.length)} debts add up to, Splitbook's simplify step, the same code the app runs, works out ${word(PAYMENTS.length)} payments, and every counter ends at zero.`,
    // The Settle up section's heading, in the story's own counts.
    headline: `${word(DEBTS.length, true)} debts between ${word(NAMES.length)} people. ${word(PAYMENTS.length, true)} payments.`,
    currency: STORY.currency,
    payments: PAYMENTS.map((p) => ({
      from: nameOf(p.from),
      to: nameOf(p.to),
      amountMinor: p.amountMinor,
    })),
    // The poses the tour shows under reduced motion, stepping from its still: the second payment
    // made, settled, the debts again, netted, then the first payment.
    poses: PAYMENTS.length + 3,
    width: W,
    height: H,
    svg,
    css: CSS,
    tour: DATA,
    recorder: R,
    projection: P,
  };
}
