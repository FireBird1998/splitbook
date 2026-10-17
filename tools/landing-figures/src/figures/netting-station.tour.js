// Fig 3's live tour: the netting station takes down the debts the Expenses left, puts up the
// payments that replace them, and the shuttle carries each payment's coins until every counter
// reads zero. tour.js runs it on the plate in the page; the web app and the preview pages bundle
// the same code with the kit functions it uses.
import { axisVector, holdStill, translateAlong } from '../../vendor/anatomy/kit/iso-kit.mjs';
import { runTour } from './tour.js';

/** Starts the tour on root; returns a function that stops it and leaves the drawing as it is. */
export function playTour(root, D) {
  return runTour(root, (tour) => nettingStation(tour, D));
}

/** The netting station's scene, for runTour. */
function nettingStation({ svg, held, say, announce }, D) {
  const P = D.P;
  const q = (sel) => svg.querySelector(sel);
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const money = (minor) => '₹' + inr.format(Math.abs(minor / 100));
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const lerp = (a, b, t) => a + (b - a) * t;
  const T = (dx, dy, dz) => translateAlong(P, [dx, dy, dz]);
  const N = D.names.length;
  // By this point of the netting the debt cords are down and the payment cords are up.
  const NET_SHOWN = 3;

  const counters = D.xs.map((_, i) => q(`[data-count="${i}"]`));
  const debts = D.debts.map((_, i) => q(`[data-debt="${i}"]`));
  const pays = D.payments.map((_, i) => q(`[data-pay="${i}"]`));
  const coins = [...svg.querySelectorAll('[data-coin]')];
  const shuttle = q('[data-part="shuttle"]');
  const hanger = q('[data-part="hanger"]');
  const lamp = q('[data-lamp="run"]');
  const screen = [0, 1, 2].map((i) => q(`[data-line="${i}"]`));
  const setScreen = (lines) =>
    screen.forEach((el, i) => {
      if (el.textContent !== (lines[i] ?? '')) el.textContent = lines[i] ?? '';
    });
  const tell = (text, loud = true) => {
    say(text);
    if (loud) announce(text);
  };
  const idx = (id) => D.ids.indexOf(id);
  const nameOf = (id) => D.names[idx(id)];
  const coinsFor = (minor) => Math.round(minor / D.coin);
  const stackZ = (n) => D.trayTop + n * D.coinT;

  // ---------------------------------------------------------------- state
  const shown = D.xs.map(() => ({ at: 0, rate: 0 }));
  let target = D.balances.slice();
  let stacks = D.xs.map(() => []);
  let carried = [];
  let phase = 'idle';
  let clock = 0;
  let pay = 0;
  let landed = false;
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
    setScreen(['NETTING', `${D.debts.length} debts`, `${N} people`]);
    tell(`${D.debts.length} debts between ${N} people`, false);
  }
  function startNet() {
    phase = 'net';
    clock = 0;
    lamp.setAttribute('data-on', '');
    setScreen(['NETTING', `${D.debts.length} debts`, `→ ${D.payments.length} pays`]);
    tell(`Netting · ${D.debts.length} debts become ${D.payments.length} payments`);
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
    landed = false;
    fromX = sx;
    const p = D.payments[j];
    setScreen([
      `PAY ${j + 1}/${D.payments.length}`,
      `${nameOf(p.from).toUpperCase()}→${nameOf(p.to).toUpperCase()}`,
      money(p.amountMinor),
    ]);
    tell(
      `Pay ${j + 1} of ${D.payments.length} · ${nameOf(p.from)} pays ${nameOf(p.to)} ${money(p.amountMinor)}`,
    );
  }
  /** The payment's coins reach the payee's tray and both counters move. */
  function land() {
    const p = D.payments[pay];
    const from = idx(p.from);
    const to = idx(p.to);
    if (carried.length) stacks[to].push(...carried);
    else stacks[to].push(...stacks[from].splice(stacks[from].length - coinsFor(p.amountMinor)));
    carried = [];
    target[from] += p.amountMinor;
    target[to] -= p.amountMinor;
    pays[pay].style.opacity = '0';
    landed = true;
  }
  /** Finishes the payment at once: the shuttle at the payee, then the next payment or the end. */
  function completePay() {
    if (!landed) land();
    sx = D.xs[idx(D.payments[pay].to)];
    drop = 0;
    if (pay + 1 < D.payments.length) {
      phase = 'paid';
      clock = 0;
    } else finish();
  }
  function finish() {
    phase = 'done';
    clock = 0;
    lamp.removeAttribute('data-on');
    setScreen(['SETTLED', `${D.payments.length} pays`, 'all ₹0']);
    tell(`Settled in ${D.payments.length} payments · every counter at 0`);
  }

  function update(dt, calm) {
    clock += dt;
    if (phase === 'idle') {
      if (clock > 1.8) startNet();
    } else if (phase === 'net') {
      debts.forEach((c, i) => (c.style.opacity = String(1 - ease((clock - i * 0.28) / 0.3))));
      pays.forEach((c, i) => (c.style.opacity = String(ease((clock - 1.4 - i * 0.3) / 0.35))));
      if (clock > 3.2) startPay(0);
    } else if (phase === 'pay') {
      const p = D.payments[pay];
      const from = idx(p.from);
      const to = idx(p.to);
      const n = coinsFor(p.amountMinor);
      const t = clock;
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
      } else if (!landed) {
        land();
      } else {
        drop = lerp(D.magRest - stackZ(stacks[to].length), 0, ease((t - 3.5) / 0.5));
        if (t > 4.3) {
          if (pay + 1 < D.payments.length) startPay(pay + 1);
          else finish();
        }
      }
    } else if (phase === 'done') {
      sx = lerp(sx, D.home, Math.min(1, dt * 2));
      if (clock > 4.2) restart();
    }
    // counters on springs
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
    holdStill(hanger, axisVector(P, [0, 0, -drop]));
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
      el.setAttribute('transform', T(sx, 0, D.magRest - drop - (carried.length - h) * D.coinT));
    });
  }

  // ---------------------------------------------------------------- stepping
  // Moving, a step plays: the netting, then each payment. Held, each step shows settled.
  function next() {
    if (phase === 'idle') {
      startNet();
      if (held()) clock = NET_SHOWN;
    } else if (phase === 'net') {
      startPay(0);
      if (held()) completePay();
    } else if (phase === 'pay') {
      completePay();
      if (!held() && phase === 'paid') startPay(pay + 1);
    } else if (phase === 'paid') {
      startPay(pay + 1);
      if (held()) completePay();
    } else restart();
  }

  // ---------------------------------------------------------------- the still
  // The documented still (#449): the debts netted, the first payment made, and the second in
  // flight, its coins on the shuttle halfway to the payee. Under reduced motion the tour opens here.
  function poseStill() {
    restart();
    startNet();
    clock = NET_SHOWN;
    update(0, true);
    startPay(0);
    completePay();
    startPay(1);
    for (let n = 0; n < 60 * 60 && clock < 2.5; n++) update(1 / 60, true);
  }

  /** Every counter has come to rest on its value. */
  const settled = () => shown.every((n, i) => n.at === target[i] && n.rate === 0);

  return { restart, next, update, draw, poseStill, settled };
}
