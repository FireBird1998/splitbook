const D = __DATA__;
const P = D.P;
const stage = document.querySelector('.fg-stage');
const svg = stage.querySelector('svg');
const readout = document.querySelector('[data-readout]');
const announce = stage.querySelector('[data-status]');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const q = (sel) => svg.querySelector(sel);
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (minor) => '₹' + inr.format(Math.abs(minor / 100));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;
const T = (dx, dy, dz) => translateAlong(P, [dx, dy, dz]);
const N = D.names.length;

const counters = D.xs.map((_, i) => q(`[data-count="${i}"]`));
const debts = D.debts.map((_, i) => q(`[data-debt="${i}"]`));
const pays = D.payments.map((_, i) => q(`[data-pay="${i}"]`));
const coins = [...svg.querySelectorAll('[data-coin]')];
const shuttle = q('[data-part="shuttle"]');
const hanger = q('[data-part="hanger"]');
const lamp = q('[data-lamp="run"]');
const screen = [0, 1, 2].map((i) => q(`[data-line="${i}"]`));
const set = (lines) =>
  screen.forEach(
    (el, i) => el.textContent !== (lines[i] ?? '') && (el.textContent = lines[i] ?? ''),
  );
const say = (text, loud = true) => {
  if (readout.textContent !== text) readout.textContent = text;
  if (loud) announce.textContent = text;
};
const idx = (id) => D.ids.indexOf(id);

// ---------------------------------------------------------------- state
const shown = D.xs.map(() => ({ at: 0, rate: 0 }));
let target = D.balances.slice();
let stacks = D.xs.map(() => []);
let carried = [];
let phase = 'idle';
let clock = 0;
let pay = 0;
let sx = D.home;
let drop = 0;
let fromX = D.home;

function restart() {
  phase = 'idle';
  clock = 0;
  pay = 0;
  target = D.balances.slice();
  shown.forEach((n, i) => {
    n.at = target[i];
    n.rate = 0;
  });
  stacks = D.xs.map(() => []);
  carried = [];
  coins.forEach((c) => (c.style.display = 'none'));
  debts.forEach((c) => (c.style.opacity = '1'));
  pays.forEach((c) => (c.style.opacity = '0'));
  sx = D.home;
  drop = 0;
  lamp.removeAttribute('data-on');
  set(['NETTING', `${D.debts.length} debts`, `${N} people`]);
  say(`${D.debts.length} debts between ${N} people`, false);
}
function coinsFor(minor) {
  return Math.round(minor / D.coin);
}
function startNet() {
  phase = 'net';
  clock = 0;
  lamp.setAttribute('data-on', '');
  set(['NETTING', `${D.debts.length} debts`, `→ ${D.payments.length} pays`]);
  say(`Netting · ${D.debts.length} debts become ${D.payments.length} payments`);
  // the debtors' trays fill with exactly what they owe
  let next = 0;
  D.balances.forEach((b, i) => {
    if (b < 0) for (let c = 0; c < coinsFor(-b); c++) stacks[i].push(next++);
  });
}
function startPay(j) {
  phase = 'pay';
  pay = j;
  clock = 0;
  fromX = sx;
  const p = D.payments[j];
  set([`PAY ${j + 1}/${D.payments.length}`, `${D.names[idx(p.from)].toUpperCase()}→${D.names[idx(p.to)].toUpperCase()}`, money(p.amountMinor)]);
  say(`${D.names[idx(p.from)]} pays ${D.names[idx(p.to)]} ${money(p.amountMinor)}`);
}
function finish() {
  phase = 'done';
  clock = 0;
  lamp.removeAttribute('data-on');
  set(['SETTLED', `${D.payments.length} pays`, 'all ₹0']);
  say(`Settled in ${D.payments.length} payments · every counter at 0`);
}

const stackZ = (n) => D.trayTop + n * D.coinT;
function update(dt, calm) {
  clock += dt;
  if (phase === 'idle') {
    if (clock > 1.8) startNet();
  } else if (phase === 'net') {
    debts.forEach((c, i) => (c.style.opacity = String(1 - ease((clock - i * 0.28) / 0.3))));
    pays.forEach((c, i) => (c.style.opacity = String(ease((clock - 1.4 - i * 0.3) / 0.35))));
    if (calm || clock > 3.2) startPay(0);
  } else if (phase === 'pay') {
    const p = D.payments[pay];
    const from = idx(p.from);
    const to = idx(p.to);
    const n = coinsFor(p.amountMinor);
    const t = clock;
    const reachFrom = 66 - stackZ(stacks[from].length) - 0.0;
    if (t < 1.0) {
      sx = lerp(fromX, D.xs[from], ease(t));
      drop = lerp(drop, 0, ease(t));
    } else if (t < 1.5) {
      sx = D.xs[from];
      drop = lerp(0, D.magRest - stackZ(stacks[from].length), ease((t - 1.0) / 0.5));
    } else if (t < 2.0) {
      if (!carried.length) carried = stacks[from].splice(stacks[from].length - n, n);
      drop = lerp(D.magRest - stackZ(stacks[from].length + n), 0, ease((t - 1.5) / 0.5));
    } else if (t < 3.0) {
      sx = lerp(D.xs[from], D.xs[to], ease(t - 2.0));
      drop = 0;
    } else if (t < 3.5) {
      sx = D.xs[to];
      drop = lerp(0, D.magRest - stackZ(stacks[to].length + n), ease((t - 3.0) / 0.5));
    } else if (carried.length) {
      stacks[to].push(...carried);
      carried = [];
      target[from] += p.amountMinor;
      target[to] -= p.amountMinor;
      pays[pay].style.opacity = '0';
    } else {
      drop = lerp(D.magRest - stackZ(stacks[to].length), 0, ease((t - 3.5) / 0.5));
      if (t > 4.3) {
        if (pay + 1 < D.payments.length) startPay(pay + 1);
        else finish();
      }
    }
    void reachFrom;
  } else if (phase === 'done') {
    sx = lerp(sx, D.home, Math.min(1, dt * 2));
    if (clock > 4.2) restart();
  }
  shown.forEach((s, i) => {
    if (calm) {
      s.at = target[i];
      s.rate = 0;
      return;
    }
    for (let k = 0; k < 6; k++) {
      s.rate += ((target[i] - s.at) * 70 - s.rate * 12) * (dt / 6);
      s.at += s.rate * (dt / 6);
    }
    if (Math.abs(target[i] - s.at) < 1 && Math.abs(s.rate) < 1) {
      s.at = target[i];
      s.rate = 0;
    }
  });
}

function draw() {
  counters.forEach((el, i) => {
    const v = Math.round(shown[i].at / 100);
    const text = v === 0 ? '0' : (v > 0 ? '+' : '−') + inr.format(Math.abs(v));
    if (el.textContent !== text) el.textContent = text;
    el.dataset.sign = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
  });
  shuttle.setAttribute('transform', T(sx - D.home, 0, 0));
  hanger.setAttribute('transform', T(0, 0, -drop));
  const [hx, hy] = axisVector(P, [0, 0, -drop]);
  holdStill(hanger, [hx, hy]);
  coins.forEach((c) => (c.style.display = 'none'));
  stacks.forEach((list, i) =>
    list.forEach((id, h) => {
      const el = coins[id];
      el.style.display = '';
      el.setAttribute('transform', T(D.xs[i], 0, stackZ(h)));
    }),
  );
  carried.forEach((id, h) => {
    const el = coins[id];
    el.style.display = '';
    const z = D.magRest - drop - (carried.length - h) * D.coinT;
    el.setAttribute('transform', T(sx, 0, z));
  });
}

// ---------------------------------------------------------------- loop and input
let frame = 0;
let last = 0;
let visible = false;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (!still.matches) update(dt, false);
  draw();
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};
function settleAll() {
  restart();
  startNet();
  debts.forEach((c) => (c.style.opacity = '0'));
  D.payments.forEach((p) => {
    const from = idx(p.from);
    const to = idx(p.to);
    stacks[to].push(...stacks[from].splice(stacks[from].length - coinsFor(p.amountMinor)));
    target[from] += p.amountMinor;
    target[to] -= p.amountMinor;
  });
  update(0, true);
  finish();
  sx = D.home;
}
function next() {
  if (phase === 'idle') startNet();
  else if (phase === 'net') startPay(0);
  else if (phase === 'pay') {
    // complete this payment at once, then start the next
    const p = D.payments[pay];
    const from = idx(p.from);
    const to = idx(p.to);
    if (carried.length) {
      stacks[to].push(...carried);
      carried = [];
    } else if (pays[pay].style.opacity !== '0') {
      stacks[to].push(...stacks[from].splice(stacks[from].length - coinsFor(p.amountMinor)));
    }
    if (pays[pay].style.opacity !== '0') {
      target[from] += p.amountMinor;
      target[to] -= p.amountMinor;
      pays[pay].style.opacity = '0';
    }
    sx = D.xs[to];
    drop = 0;
    if (pay + 1 < D.payments.length) startPay(pay + 1);
    else finish();
  } else restart();
  run();
}
new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  },
  { rootMargin: '120px 0px' },
).observe(stage);
stage.addEventListener('click', next);
stage.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') next();
  else if (event.key === 'Home') {
    restart();
    run();
  } else return;
  event.preventDefault();
});
restart();
if (still.matches) settleAll();
draw();
