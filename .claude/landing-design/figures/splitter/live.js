const D = __DATA__;
const P = D.P;
const stage = document.querySelector('.sb-stage');
const svg = stage.querySelector('svg');
const readout = document.querySelector('[data-readout]');
const announce = stage.querySelector('[data-status]');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const q = (sel) => svg.querySelector(sel);
const qa = (sel) => [...svg.querySelectorAll(sel)];
const NAME = Object.fromEntries(D.members.map((m) => [m.id, m.name]));
const IDS = D.members.map((m) => m.id);
const rupees = (minor) => minor / 100;
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (minor) => '₹' + inr.format(Math.abs(rupees(minor)));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

// The story as a sequence of states, each with the balances it ends on.
const SEQ = [];
let running = Object.fromEntries(IDS.map((id) => [id, 0]));
D.steps.forEach((step, i) => {
  running = { ...step.after };
  SEQ.push({ kind: 'expense', i, after: { ...running } });
});
D.transfers.forEach((t, j) => {
  running = {
    ...running,
    [t.from]: running[t.from] + t.amountMinor,
    [t.to]: running[t.to] - t.amountMinor,
  };
  SEQ.push({ kind: 'settle', j, after: { ...running } });
});
SEQ.push({ kind: 'done', after: { ...running } });
const ZEROS = Object.fromEntries(IDS.map((id) => [id, 0]));

function describe(item) {
  if (!item) return 'Group · all settled';
  if (item.kind === 'expense') {
    const s = D.steps[item.i];
    const split =
      s.method === 'equal'
        ? `equally between ${s.between.length}`
        : `by shares ${s.shares.join(':')}`;
    return `${s.title} ${money(s.amountMinor)} · ${NAME[s.paidBy]} paid · ${split}`;
  }
  if (item.kind === 'settle') {
    const t = D.transfers[item.j];
    return `Settle up · ${NAME[t.from]} pays ${NAME[t.to]} ${money(t.amountMinor)}`;
  }
  return `Settled in ${D.transfers.length} payments · every dial at 0`;
}

// ---------------------------------------------------------------- parts
const needles = IDS.map((_, i) => q(`[data-needle="${i}"]`));
const sectors = IDS.map((_, i) => q(`[data-sector="${i}"]`));
const counters = IDS.map((_, i) => q(`[data-count="${i}"]`));
const stations = IDS.map((_, i) => q(`[data-station="${i}"]`));
const carriage = q('[data-part="carriage"]');
const coin = q('[data-part="coin"]');
const coinSlots = IDS.map((_, i) => q(`[data-coin-slot="${i}"]`));
const puck = q('[data-part="puck"]');
const pointer = q('[data-part="pointer"]');
const spokes = q('[data-part="spokes"]');
const crank = q('[data-part="crank"]');
const lever = q('[data-part="lever"]');
const bolts = D.couplings.map((_, i) => q(`[data-bolts="${i}"]`));

const angleOf = (minor) =>
  D.dial.zero + D.dial.sign * D.dial.sweep * Math.max(-1, Math.min(1, rupees(minor) / D.dial.max));
function drawDial(i, minor) {
  const x = D.xs[i];
  const y = D.dial.y;
  const R = D.dial.R;
  const a = angleOf(minor);
  const s = Math.sin(a);
  const c = Math.cos(a);
  needles[i].setAttribute(
    'd',
    lineOnTop([x - s * 3.4, y + c * 3.4], [x + s * (R - 4), y - c * (R - 4)], D.dial.top + 0.2, P),
  );
  const v = Math.round(rupees(minor));
  if (Math.abs(rupees(minor)) < 0.5) {
    sectors[i].setAttribute('d', '');
  } else {
    const n = Math.max(2, Math.ceil(Math.abs(a - D.dial.zero) / 0.08));
    const pts = [[x, y]];
    for (let k = 0; k <= n; k++) {
      const t = D.dial.zero + ((a - D.dial.zero) * k) / n;
      pts.push([x + Math.sin(t) * (R - 4.4), y - Math.cos(t) * (R - 4.4)]);
    }
    sectors[i].setAttribute('d', onTop(pts, D.dial.top + 0.05, P, true));
    sectors[i].dataset.sign = minor > 0 ? 'pos' : 'neg';
  }
  const text = v === 0 ? '0' : (v > 0 ? '+' : '−') + inr.format(Math.abs(v));
  if (counters[i].textContent !== text) counters[i].textContent = text;
  counters[i].dataset.sign = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
}

const XF = () => G.frameOf([0, D.shaft.y, D.shaft.z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
function drawShaft(angle) {
  bolts.forEach((el, i) => {
    const F = XF();
    el.innerHTML = dotsSvg(
      G.dotsOf(F, D.couplings[i] + 2.2, 4.3, 6, P, { phase: angle, all: true }),
      { size: 0.5, tone: 'lo' },
    );
  });
  const F = XF();
  const W = D.wheel;
  // a flywheel web: five lightening holes that turn with the shaft
  const face = W.x + 1;
  let holes = '';
  for (let k = 0; k < 5; k++) {
    const hole = G.frameOf(G.pointOf(F, face, 7.4, angle + (k * Math.PI * 2) / 5), F.a, F.u, F.v);
    const d = G.circleOf(hole, 0.02, 1.9, P);
    holes += `<path class="sb-hole" d="${d}"/><path class="iso-line" data-tone="lo" d="${d}"/>`;
  }
  spokes.innerHTML = '';
  const t = angle + 0.6;
  const base = G.pointOf(F, W.x + W.t / 2, W.rim + 1.6, t);
  const CF = G.frameAlong(base, [1, 0, 0]);
  crank.innerHTML =
    holes +
    solidSvg(G.disc(0, 5, 1.3, CF, P, { steps: 16 }), { tone: 'mid' }) +
    solidSvg(G.sphereOf(G.add3(base, [6.2, 0, 0]), 2, P, { steps: 24 }), { tone: 'hi' });
}

function drawLever(theta) {
  const base = G.add3(D.pivot, [8.6, 0, 0]);
  const BF = G.frameAlong(G.add3(D.pivot, [7.4, 0, 0]), [1, 0, 0]);
  const dir = [0, Math.sin(theta), Math.cos(theta)];
  const F = G.frameAlong(base, dir);
  const tip = G.add3(base, G.mul3(dir, D.lever.length));
  lever.innerHTML =
    solidSvg(G.disc(0, 2.4, 3, BF, P), { tone: 'mid' }) +
    solidSvg(G.disc(0, D.lever.length, D.lever.r, F, P, { steps: 16 }), { tone: 'mid' }) +
    solidSvg(G.sphereOf(tip, D.lever.knob, P, { steps: 32 }), { tone: 'hi' });
}

function drawSelector(t) {
  const [x, y] = D.selector.at;
  pointer.setAttribute(
    'd',
    lineOnTop(
      [x + Math.sin(t) * 1.3, y - Math.cos(t) * 1.3],
      [x + Math.sin(t) * 5.8, y - Math.cos(t) * 5.8],
      8,
      P,
    ),
  );
}

// ---------------------------------------------------------------- state
const pose = {
  shown: Object.fromEntries(IDS.map((id) => [id, { at: 0, rate: 0 }])),
  target: { ...ZEROS },
  carriage: D.carriageHome,
  carriageFrom: D.carriageHome,
  puck: D.puckHome,
  puckFrom: D.puckHome,
  lever: D.lever.rest,
  leverFrom: D.lever.rest,
  selector: D.selector.detents[0],
  selectorFrom: D.selector.detents[0],
  shaft: 0,
  spin: 0,
  coinVisible: false,
};
let index = -1;
let clock = 0;
let landed = false;
let arrived = false;

function begin(next) {
  const prev = SEQ[index];
  index = next;
  clock = 0;
  landed = false;
  arrived = false;
  pose.target = { ...(prev ? prev.after : ZEROS) };
  pose.carriageFrom = pose.carriage;
  pose.puckFrom = pose.puck;
  pose.leverFrom = pose.lever;
  pose.selectorFrom = pose.selector;
  pose.coinVisible = false;
  coin.style.display = 'none';
  const item = SEQ[index];
  const text = describe(item);
  readout.textContent = text;
  announce.textContent = text;
  if (item && item.kind === 'expense') {
    const s = D.steps[item.i];
    stations.forEach((el, i) =>
      s.between.includes(IDS[i]) ? el.setAttribute('data-on', '') : el.removeAttribute('data-on'),
    );
  } else {
    stations.forEach((el) => el.setAttribute('data-on', ''));
  }
}

function update(dt, calm) {
  const item = SEQ[index];
  clock += dt;
  if (item && item.kind === 'expense') {
    const s = D.steps[item.i];
    const payer = IDS.indexOf(s.paidBy);
    const method = D.selector.methods.indexOf(s.method);
    pose.selector = lerp(
      pose.selectorFrom,
      D.selector.detents[method],
      calm ? 1 : ease(clock / 0.5),
    );
    const goal = D.xs[payer];
    pose.carriage = lerp(pose.carriageFrom, goal, calm ? 1 : ease((clock - 0.3) / 1.3));
    pose.lever = lerp(pose.leverFrom, D.lever.rest, calm ? 1 : ease(clock / 0.5));
    if (!calm && clock > 1.7 && !landed) {
      const t = clock - 1.7;
      const z = D.coin.top - 0.5 * 816 * t * t;
      if (z <= D.coin.land) {
        landed = true;
        coin.style.display = 'none';
      } else {
        if (coin.parentNode !== coinSlots[payer]) coinSlots[payer].appendChild(coin);
        const [x0, y0] = D.coin.start;
        const [x1, y1] = D.drop[payer];
        coin.setAttribute('transform', translateAlong(P, [x1 - x0, y1 - y0, z - D.coin.top]));
        coin.style.display = '';
      }
    }
    if (calm && !landed) landed = true;
    if (landed) {
      pose.target = { ...item.after };
      pose.spin = 1;
    }
  } else if (item && item.kind === 'settle') {
    const t = D.transfers[item.j];
    pose.lever = lerp(pose.leverFrom, D.lever.pulled, calm ? 1 : ease(clock / 0.5));
    const from = D.xs[IDS.indexOf(t.from)];
    const to = D.xs[IDS.indexOf(t.to)];
    if (calm) pose.puck = to;
    else if (clock < 1.4) pose.puck = lerp(pose.puckFrom, from, ease((clock - 0.4) / 0.9));
    else pose.puck = lerp(from, to, ease((clock - 1.5) / 1.3));
    if (calm || clock > 2.8) arrived = true;
    if (arrived) {
      pose.target = { ...item.after };
      pose.spin = 1;
    }
  } else if (item && item.kind === 'done') {
    pose.lever = lerp(pose.leverFrom, D.lever.rest, calm ? 1 : ease(clock / 0.6));
    pose.puck = lerp(pose.puckFrom, D.puckHome, calm ? 1 : ease((clock - 0.3) / 1.2));
    pose.target = { ...item.after };
  } else {
    pose.carriage = lerp(pose.carriageFrom, D.carriageHome, calm ? 1 : ease(clock / 1.2));
  }
  // needles on real springs; the shaft turns while any dial is moving
  let moving = 0;
  IDS.forEach((id) => {
    const n = pose.shown[id];
    const want = pose.target[id];
    if (calm) {
      n.at = want;
      n.rate = 0;
      return;
    }
    for (let k = 0; k < 6; k++) {
      n.rate += ((want - n.at) * 90 - n.rate * 13) * (dt / 6);
      n.at += n.rate * (dt / 6);
    }
    if (Math.abs(want - n.at) < 1 && Math.abs(n.rate) < 1) {
      n.at = want;
      n.rate = 0;
    }
    moving += Math.abs(n.rate);
  });
  pose.spin = calm ? 0 : Math.min(1, moving / 40000);
  pose.shaft += pose.spin * dt * 7;
}

function draw() {
  IDS.forEach((id, i) => drawDial(i, pose.shown[id].at));
  carriage.setAttribute('transform', translateAlong(P, [pose.carriage - D.carriageHome, 0, 0]));
  puck.setAttribute('transform', translateAlong(P, [pose.puck - D.puckHome, 0, 0]));
  drawShaft(pose.shaft);
  drawLever(pose.lever);
  drawSelector(pose.selector);
}

// ---------------------------------------------------------------- loop, tour, input
const HOLD = { expense: 4.6, settle: 3.8, done: 3.4, start: 2.2 };
let frame = 0;
let last = 0;
let visible = false;
let touring = !still.matches;
let idle = 0;
const length = (item) => (item ? HOLD[item.kind] : HOLD.start);
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  update(dt, calm);
  draw();
  if (touring && clock > length(SEQ[index])) begin(index + 1 >= SEQ.length ? -1 : index + 1);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};
function step(to) {
  touring = false;
  clearTimeout(idle);
  begin(to);
  if (still.matches) {
    update(0, true);
    draw();
  }
  idle = setTimeout(() => {
    touring = !still.matches;
  }, 6000);
  run();
}
new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  },
  { rootMargin: '120px 0px' },
).observe(stage);
stage.addEventListener('click', () => step(index + 1 >= SEQ.length ? -1 : index + 1));
stage.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter')
    step(index + 1 >= SEQ.length ? -1 : index + 1);
  else if (event.key === 'ArrowLeft') step(Math.max(-1, index - 1));
  else if (event.key === 'Home') step(-1);
  else return;
  event.preventDefault();
});
begin(-1);
if (still.matches) {
  begin(2);
  update(0, true);
}
draw();
