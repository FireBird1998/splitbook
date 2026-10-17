const D = __DATA__;
const P = D.P;
const stage = document.querySelector('.fg-stage');
const svg = stage.querySelector('svg');
const readout = document.querySelector('[data-readout]');
const announce = stage.querySelector('[data-status]');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const q = (sel) => svg.querySelector(sel);
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (minor) => '₹' + inr.format(minor / 100);
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;
const T = (dx, dy, dz) => translateAlong(P, [dx, dy, dz]);

const bars = D.items.map((_, i) => q(`[data-bar="${i}"]`));
const inRack = q('[data-part="in-rack"]');
const onBelt = q('[data-part="on-belt"]');
const gate = q('[data-part="gate"]');
const lever = q('[data-part="lever"]');
const count = q('[data-count="rack"]');
const lamp = q('[data-lamp="link"]');
const marks = q('[data-part="belt-marks"]');
const term = [0, 1, 2].map((i) => q(`.rv-desk [data-line="${i}"]:not([data-hood])`));
const hood = [0, 1].map((i) => q(`[data-hood="${i}"]`));

const set = (els, lines) =>
  els.forEach((el, i) => el.textContent !== (lines[i] ?? '') && (el.textContent = lines[i] ?? ''));
const say = (text, loud = true) => {
  if (readout.textContent !== text) readout.textContent = text;
  if (loud) announce.textContent = text;
};
const split = (item) => {
  const same = item.chips.every((c) => c === item.chips[0]);
  return same ? `${item.chips.length} × ${money(item.chips[0])}` : `${item.chips.length} chips`;
};

// ---------------------------------------------------------------- state
let phase = 'idle';
let clock = 0;
let waiting = 0;
let beltTravel = 0;
const pose = { lever: D.lever.rest, gate: 0 };
const bar = D.items.map(() => ({ x: 0, slot: 0, z: 0, fall: 0, where: 'store' }));

function restart() {
  phase = 'idle';
  clock = 0;
  waiting = 0;
  bar.forEach((b, i) => {
    b.where = 'store';
    bars[i].style.display = 'none';
    q('[data-part="store"]').appendChild(bars[i]);
  });
  set(term, ['CLAUDE', 'connected', 'read · prepare']);
  set(hood, ['TO THE LINE', '']);
  lamp.setAttribute('data-on', '');
  say('Claude connected · To review empty', false);
}
function send(i) {
  phase = `send${i}`;
  clock = 0;
  const item = D.items[i];
  set(term, ['CLAUDE', `${item.title} ${money(item.amountMinor)}`, '→ To review']);
  say(`Claude prepares ${item.title} ${money(item.amountMinor)} · ${split(item)}`);
}
function release() {
  phase = 'release';
  clock = 0;
  say(`You pull the lever · ${D.items[0].title} ${money(D.items[0].amountMinor)} is saved`);
}

function update(dt, calm) {
  clock += dt;
  if (phase === 'idle') {
    if (clock > 1.8) send(0);
  } else if (phase === 'send0' || phase === 'send1') {
    const i = phase === 'send0' ? 0 : 1;
    const b = bar[i];
    if (b.where === 'store' && (calm || clock > 0.9)) {
      b.where = 'falling';
      b.slot = i;
      b.z = D.rack.top - 4 - D.rack.z0;
      b.fall = 0;
      b.x = 0;
      inRack.appendChild(bars[i]);
      bars[i].style.display = '';
    }
    if (b.where === 'falling') {
      b.fall += dt;
      const floor = b.slot * D.chipH;
      b.z = calm
        ? floor
        : Math.max(floor, D.rack.top - 4 - D.rack.z0 - 0.5 * 700 * b.fall * b.fall);
      if (b.z <= floor) {
        b.where = 'rack';
        waiting += 1;
        say(
          `${D.items[i].title} ${money(D.items[i].amountMinor)} is in To review · waiting for you`,
          false,
        );
      }
    }
    if (b.where === 'rack' && clock > 2.4) {
      if (i === 0) send(1);
      else release();
    }
  } else if (phase === 'release') {
    const b = bar[0];
    const top = bar[1];
    const len = D.items[0].chips.length * D.cw;
    pose.lever = lerp(D.lever.rest, D.lever.pulled, calm ? 1 : ease(clock / 0.45));
    if (b.where === 'rack') {
      pose.gate = calm ? 7 : 7 * ease((clock - 0.3) / 0.3);
      if (calm || clock > 0.65) b.where = 'sliding';
    }
    if (b.where === 'sliding') {
      const step = calm ? 999 : 115 * dt;
      b.x += step;
      if (b.x - len / 2 > D.rack.x1 - D.rack.x && bars[0].parentNode !== onBelt)
        onBelt.appendChild(bars[0]);
      if (bars[0].parentNode === onBelt) beltTravel += Math.min(step, 999);
      if (b.x - len / 2 > D.rack.x1 + 5 - D.rack.x) {
        pose.gate = Math.max(0, pose.gate - dt * 30);
        if (top.where === 'rack' && top.slot === 1) {
          top.where = 'settling';
          top.fall = 0;
        }
      }
      const hoodX = D.hood.x + len / 2 + 2 - D.rack.x;
      if (b.x >= hoodX) {
        b.where = 'saved';
        bars[0].style.display = 'none';
        waiting -= 1;
        set(hood, ['SAVED', `${D.items[0].title} ${money(D.items[0].amountMinor)}`]);
      }
    }
    if (top.where === 'settling') {
      top.fall += dt;
      top.z = calm ? 0 : Math.max(0, D.chipH - 0.5 * 700 * top.fall * top.fall);
      if (top.z <= 0) {
        top.where = 'rack';
        top.slot = 0;
      }
    }
    if (b.where === 'saved') {
      pose.lever = lerp(D.lever.pulled, D.lever.rest, calm ? 1 : ease((clock - 1.6) / 0.5));
      pose.gate = 0;
      if (calm || clock > 2.4) {
        phase = 'hold';
        clock = 0;
        set(term, ['CLAUDE', 'waiting on you', '1 in To review']);
        say(
          `${D.items[1].title} ${money(D.items[1].amountMinor)} waits in To review · nothing moves until you save it`,
        );
      }
    }
  } else if (phase === 'hold') {
    if (clock > 3.6) restart();
  }
}

function draw() {
  bar.forEach((b, i) => {
    if (b.where === 'store' || b.where === 'saved') return;
    const z =
      b.where === 'falling' || b.where === 'settling' || b.where === 'rack'
        ? b.where === 'rack'
          ? b.slot * D.chipH
          : b.z
        : 0;
    bars[i].setAttribute('transform', T(D.rack.x + b.x, 0, D.rack.z0 + z));
  });
  gate.setAttribute('transform', T(0, 0, pose.gate));
  const base = [D.lever.x, D.lever.y, D.lever.z];
  const dir = [0, Math.sin(pose.lever), Math.cos(pose.lever)];
  const F = G.frameAlong(base, dir);
  const tip = G.add3(base, G.mul3(dir, D.lever.length));
  lever.innerHTML =
    solidSvg(G.disc(0, D.lever.length, D.lever.r, F, P, { steps: 16 }), { tone: 'mid' }) +
    solidSvg(G.sphereOf(tip, D.lever.knob, P, { steps: 32 }), { tone: 'hi', lit: true });
  const v = Math.max(0, waiting);
  if (count.textContent !== String(v)) count.textContent = String(v);
  const pitch = 12;
  let d = '';
  for (let x = D.belt.x0 + 3 + (beltTravel % pitch); x < D.belt.x1 - 2; x += pitch)
    d += lineOnTop([x, D.belt.y0], [x, D.belt.y1], D.belt.top, P);
  marks.innerHTML = `<path class="iso-line" data-tone="faint" d="${d}"/>`;
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
function finishAll() {
  // jump straight to the end of the story: Dinner saved, Cab waiting
  restart();
  send(0);
  update(0, true);
  update(0, true);
  send(1);
  update(0, true);
  update(0, true);
  release();
  for (let i = 0; i < 6; i++) update(0, true);
}
function next() {
  if (phase === 'idle') send(0);
  else if (phase === 'send0') {
    if (bar[0].where !== 'rack') update(0, true);
    send(1);
  } else if (phase === 'send1') {
    if (bar[1].where !== 'rack') update(0, true);
    release();
  } else if (phase === 'release') finishAll();
  else restart();
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
if (still.matches) finishAll();
draw();
