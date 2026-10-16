// Fig 1's live tour: the splitting line runs the story an Expense at a time. It works on a plate
// already in the page (the figure's SVG at rest inside `.ln-stage`, a `[data-readout]` and a
// `[data-status]` live region) and plays the tour data the figure module builds from the story.
// The web app and the preview pages run the same code, bundled with the kit functions it uses.
import {
  axisVector,
  holdStill,
  lineOnTop,
  translateAlong,
} from '../../vendor/anatomy/kit/iso-kit.mjs';

/** Starts the tour on root; returns a function that stops it and leaves the drawing as it is. */
export function playTour(root, D) {
  const P = D.P;
  const stage = root.querySelector('.ln-stage');
  const svg = stage.querySelector('svg');
  const readout = root.querySelector('[data-readout]');
  const announce = stage.querySelector('[data-status]');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const q = (sel) => svg.querySelector(sel);
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const money = (minor) => '₹' + inr.format(Math.abs(minor / 100));
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const lerp = (a, b, t) => a + (b - a) * t;

  const onBelt = q('[data-part="on-belt"]');
  const inMag = q('[data-part="in-mag"]');
  const drops = D.xs.map((_, i) => q(`[data-drop="${i}"]`));
  const chutes = D.xs.map((_, i) => q(`[data-chute="${i}"]`));
  const bars = D.steps.map((_, i) => q(`[data-bar="${i}"]`));
  const chips = [...svg.querySelectorAll('[data-chip]')];
  const stacks = D.xs.map((_, i) => [0, 1, 2, 3].map((j) => q(`[data-stack="${i}-${j}"]`)));
  const pushers = D.xs.map((_, i) => q(`[data-pusher="${i}"]`));
  const counters = D.xs.map((_, i) => q(`[data-count="${i}"]`));
  const payLamps = D.xs.map((_, i) => q(`[data-paid="${i}"]`));
  const runLamp = q('[data-lamp="run"]');
  const sawHead = q('[data-part="saw-head"]');
  const sawSlide = q('[data-part="saw-slide"]');
  const beltMarks = q('[data-part="belt-marks"]');
  const screen = [0, 1, 2].map((i) => q(`[data-line="${i}"]`));

  const T = (dx, dy, dz) => translateAlong(P, [dx, dy, dz]);
  const chipValues = (s) => s.chips.map((c) => c.amountMinor);
  function screenFor(s) {
    const values = chipValues(s);
    const same = values.every((v) => v === values[0]);
    return [
      s.title.toUpperCase(),
      money(s.amountMinor),
      same ? `${values.length} × ${money(values[0])}` : `${values.length} chips`,
    ];
  }

  // ---------------------------------------------------------------- state
  const shown = D.xs.map(() => ({ at: 0, rate: 0 }));
  let target = D.xs.map(() => 0);
  let fill = D.xs.map(() => 0);
  let beltTravel = 0;
  let phase = 'idle';
  // The Pause button holds the line where it is; under reduced motion it is always held.
  let paused = false;
  const held = () => still.matches || paused;
  let e = -1;
  let clock = 0;
  let bar = { x: D.mag, onBelt: false };
  let cut = { k: 0, sub: 0, t: 0 };
  let saw = { y: -30, dz: 0 };
  let line = [];
  let pushing = null;
  let pushersY = D.xs.map(() => 0);

  function setScreen(lines) {
    screen.forEach((el, i) => {
      if (el.textContent !== (lines[i] ?? '')) el.textContent = lines[i] ?? '';
    });
  }
  function say(text) {
    if (readout.textContent !== text) readout.textContent = text;
  }
  function announceText(text) {
    announce.textContent = text;
  }
  function resetMagazine() {
    bars.forEach((el, i) => {
      if (el.parentNode !== inMag) inMag.appendChild(el);
      el.setAttribute('transform', T(D.mag, 0, -2.4 * i));
      el.style.display = '';
      el.querySelectorAll('[data-cut]').forEach((c) => (c.style.display = 'none'));
    });
  }
  function liftMagazine(from) {
    bars.forEach((el, i) => {
      if (i < from) return;
      el.setAttribute('transform', T(D.mag, 0, -2.4 * (i - from)));
    });
  }

  function begin(next) {
    e = next;
    clock = 0;
    pushing = null;
    if (e >= D.steps.length) {
      phase = 'done';
      payLamps.forEach((l) => l.removeAttribute('data-on'));
      setScreen([
        'DONE',
        `${D.steps.length} split`,
        `sum ${money(target.reduce((a, b) => a + b, 0))}`,
      ]);
      const text = D.names
        .map(
          (n, i) =>
            `${n} ${target[i] > 0 ? '+' : target[i] < 0 ? '−' : ''}${inr.format(Math.abs(target[i] / 100))}`,
        )
        .join(' · ');
      say(text);
      announceText(`All ${D.steps.length} Expenses split. ${text}`);
      return;
    }
    const s = D.steps[e];
    phase = 'load';
    bar = { x: D.mag, onBelt: false };
    cut = { k: 0, sub: 0, t: 0 };
    line = [];
    payLamps.forEach((l, i) =>
      i === s.paidBy ? l.setAttribute('data-on', '') : l.removeAttribute('data-on'),
    );
    target[s.paidBy] += s.amountMinor;
    setScreen(screenFor(s));
    const text = `${s.title} ${money(s.amountMinor)} · ${D.names[s.paidBy]} paid`;
    say(text);
    announceText(text);
  }

  function restart() {
    e = -1;
    phase = 'idle';
    clock = 0;
    target = D.xs.map(() => 0);
    fill = D.xs.map(() => 0);
    stacks.flat().forEach((el) => (el.style.display = 'none'));
    chips.forEach((c) => {
      c.style.display = 'none';
      q('[data-part="store"]').appendChild(c);
    });
    payLamps.forEach((l) => l.removeAttribute('data-on'));
    resetMagazine();
    setScreen(['READY', `${D.steps.length} Expenses`, '']);
    say(`Line idle · ${D.steps.length} Expenses waiting`);
  }

  // the boundaries a bar is cut at, leading end first
  const nOf = (s) => s.chips.length;
  const cutX = (s, k) => D.blade + (nOf(s) * D.cw) / 2 - k * D.cw;
  function finishInstantly() {
    if (e < 0 || e >= D.steps.length) return;
    const s = D.steps[e];
    bars[e].style.display = 'none';
    chips.forEach((c) => (c.style.display = 'none'));
    s.chips.forEach((c) => {
      if (fill[c.to] < 4) stacks[c.to][fill[c.to]].style.display = '';
      fill[c.to] += 1;
    });
    target = s.after.slice();
    pushersY = D.xs.map(() => 0);
    liftMagazine(e + 1);
  }

  function update(dt, calm) {
    clock += dt;
    if (phase === 'load') {
      const s = D.steps[e];
      const t = ease(clock / 1.0);
      bar.x = lerp(D.mag, D.loadX, t);
      const half = (nOf(s) * D.cw) / 2;
      if (!bar.onBelt && bar.x - half > D.mag + 27) {
        onBelt.appendChild(bars[e]);
        bar.onBelt = true;
      }
      bars[e].setAttribute('transform', T(bar.x, 0, 0));
      liftMagazine(e + 1);
      beltTravel += Math.max(0, bar.x - (bar._last ?? bar.x));
      bar._last = bar.x;
      if (clock >= 1.0) {
        if (!bar.onBelt) {
          onBelt.appendChild(bars[e]);
          bar.onBelt = true;
        }
        phase = 'toSaw';
        clock = 0;
        cut = { k: nOf(s) - 1, sub: 0, t: 0, from: bar.x };
      }
    } else if (phase === 'toSaw' || phase === 'cut') {
      const s = D.steps[e];
      if (phase === 'toSaw') {
        const goal = cutX(s, cut.k);
        const speed = 90;
        const step = Math.min(speed * dt, goal - bar.x);
        bar.x += step;
        beltTravel += step;
        if (goal - bar.x < 0.01) {
          bar.x = goal;
          phase = 'cut';
          cut.sub = 0;
          cut.t = 0;
        }
      } else {
        cut.t += dt;
        const dur = [0.22, 0.42, 0.16];
        if (cut.sub === 0) {
          saw.dz = lerp(0, -10.1, ease(cut.t / dur[0]));
          saw.y = -30;
          if (cut.t >= dur[0]) {
            cut.sub = 1;
            cut.t = 0;
          }
        } else if (cut.sub === 1) {
          saw.y = lerp(-30, -1, ease(cut.t / dur[1]));
          const line = bars[e].querySelector(`[data-cut="${cut.k}"]`);
          const lx = -(nOf(s) * D.cw) / 2 + cut.k * D.cw;
          const y0 = D.chip.y - D.chip.d / 2;
          const y1 = Math.min(D.chip.y + D.chip.d / 2, saw.y);
          if (y1 > y0) {
            line.style.display = '';
            line.setAttribute('d', lineOnTop([lx, y0], [lx, y1], D.belt.top + D.chip.h + 0.02, P));
            if (y1 < D.chip.y + D.chip.d / 2) line.setAttribute('data-free', 'end');
            else line.removeAttribute('data-free');
          }
          if (cut.t >= dur[1]) {
            cut.sub = 2;
            cut.t = 0;
          }
        } else {
          saw.dz = lerp(-10.1, 0, ease(cut.t / dur[2]));
          if (cut.t >= dur[2]) {
            saw.y = -30;
            cut.k -= 1;
            if (cut.k >= 1) {
              phase = 'toSaw';
            } else {
              phase = 'spread';
              clock = 0;
              // swap the cut bar for loose chips in the same places
              bars[e].style.display = 'none';
              const half = (nOf(s) * D.cw) / 2;
              line = s.chips.map((c, j) => ({
                ...c,
                x: bar.x + half - (j + 0.5) * D.cw,
                y: D.chip.y,
                z: 0,
                el: chips[j],
                state: 'belt',
              }));
              line.forEach((c) => {
                onBelt.appendChild(c.el);
                c.el.style.display = '';
                c.el.setAttribute('transform', T(c.x, 0, 0));
              });
              say(`Cut into ${line.length} chips · ${screenFor(s)[2]}`);
            }
          }
        }
      }
      bars[e].setAttribute('transform', T(bar.x, 0, 0));
    } else if (phase === 'spread' || phase === 'sort') {
      const s = D.steps[e];
      if (phase === 'spread') {
        const t = ease(clock / 0.7);
        const lead = bar.x + (nOf(s) * D.cw) / 2 - D.cw / 2;
        line.forEach((c, j) => (c.x = lead + t * 10 - j * lerp(D.cw, 15, t)));
        if (clock >= 0.7) {
          phase = 'sort';
          clock = 0;
          say(`${s.title}: each chip to the bin it belongs to`);
        }
      } else if (!pushing) {
        // move the belt until the next chip lines up with its bin
        const waiting = line.filter((c) => c.state === 'belt');
        if (!waiting.length) {
          if (line.every((c) => c.state === 'landed')) {
            phase = 'hold';
            clock = 0;
            say(`${s.title} split · the counters add up to ₹0`);
          }
        } else {
          const next = waiting.reduce((a, b) => (D.xs[b.to] - b.x < D.xs[a.to] - a.x ? b : a));
          const gap = D.xs[next.to] - next.x;
          const step = Math.min(110 * dt, Math.max(0, gap));
          waiting.forEach((c) => (c.x += step));
          beltTravel += step;
          if (gap - step < 0.01) {
            next.x = D.xs[next.to];
            pushing = { chip: next, t: 0 };
          }
        }
      }
      if (pushing) {
        const c = pushing.chip;
        const st = c.to;
        pushing.t += dt;
        const t = pushing.t;
        const reach = D.push.stroke;
        if (t < 0.28) {
          const k = ease(t / 0.28);
          pushersY[st] = reach * k;
          const head = D.push.rest + pushersY[st];
          c.y = Math.max(D.chip.y, head + D.chip.d / 2);
          c.z = 0;
        } else {
          pushersY[st] = reach * (1 - ease((t - 0.28) / 0.3));
          if (c.state === 'belt') {
            c.state = 'falling';
            chutes[st].appendChild(c.el);
          }
          const u = Math.min(1, (t - 0.28) / 0.55);
          const ch = D.chute;
          const yEnd = (D.bin.y0 + D.bin.y1) / 2;
          const zEnd = 1.6 + Math.min(fill[st], 3) * D.chip.h - D.belt.top;
          if (u < 0.6) {
            const v = ease(u / 0.6);
            const y = lerp(D.push.rest + reach + D.chip.d / 2, ch.yB + 2, v);
            const surface =
              ch.zA +
              ((Math.min(Math.max(y, ch.yA), ch.yB) - ch.yA) * (ch.zB - ch.zA)) / (ch.yB - ch.yA);
            c.y = y;
            c.z = surface - D.belt.top;
          } else {
            if (c.el.parentNode !== drops[st]) drops[st].appendChild(c.el);
            const v = ease((u - 0.6) / 0.4);
            c.y = lerp(ch.yB + 2, yEnd, v);
            c.z = lerp(ch.zB - D.belt.top, zEnd, v * v);
          }
          if (u >= 1 && c.state === 'falling') {
            c.state = 'landed';
            c.el.style.display = 'none';
            if (fill[st] < 4) stacks[st][fill[st]].style.display = '';
            fill[st] += 1;
            target[st] -= c.amountMinor;
          }
          if (t >= 0.9) {
            pushersY[st] = 0;
            pushing = null;
          }
        }
      }
      line.forEach((c) => {
        if (c.state !== 'landed') c.el.setAttribute('transform', T(c.x, c.y - D.chip.y, c.z));
      });
    } else if (phase === 'hold' && clock > 1.4) {
      begin(e + 1);
    } else if (phase === 'done' && clock > 4.5) {
      restart();
    } else if (phase === 'idle' && clock > 1.6) {
      begin(0);
    }
    // counters on springs
    shown.forEach((n, i) => {
      if (calm) {
        n.at = target[i];
        n.rate = 0;
        return;
      }
      for (let k = 0; k < 6; k++) {
        n.rate += ((target[i] - n.at) * 70 - n.rate * 12) * (dt / 6);
        n.at += n.rate * (dt / 6);
      }
      if (Math.abs(target[i] - n.at) < 1 && Math.abs(n.rate) < 1) {
        n.at = target[i];
        n.rate = 0;
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
    pushers.forEach((el, i) => {
      const off = translateAlong(P, [0, pushersY[i], 0]);
      el.setAttribute('transform', off);
      const [dx, dy] = axisVector(P, [0, pushersY[i], 0]);
      holdStill(el, [dx, dy]);
    });
    sawHead.setAttribute('transform', T(0, saw.y, 0));
    sawSlide.setAttribute('transform', T(0, 0, saw.dz));
    const running = phase !== 'idle' && phase !== 'done';
    if (running) runLamp.setAttribute('data-on', '');
    else runLamp.removeAttribute('data-on');
    // belt marks travel with the belt
    const pitch = 14;
    const phaseX = beltTravel % pitch;
    let marks = '';
    for (let x = D.belt.x0 + 4 + phaseX; x < D.belt.x1 - 3; x += pitch) {
      marks += lineOnTop([x, D.belt.y0], [x, D.belt.y1], D.belt.top, P);
    }
    beltMarks.innerHTML = `<path class="iso-line" data-tone="faint" d="${marks}"/>`;
  }

  // ---------------------------------------------------------------- the still
  // The documented still (#448): Dinner and Cab split, then the last Expense run on a fixed clock
  // until its first chip slides down its chute. The payer's counter has risen and no chip has
  // landed, so the counters read +900, +100, +500 and −500. Under reduced motion the tour opens here.
  function poseStill() {
    restart();
    const lastStep = D.steps.length - 1;
    for (let i = 0; i < lastStep; i++) {
      begin(i);
      finishInstantly();
    }
    begin(lastStep);
    for (let n = 0; n < 60 * 60 && !(pushing && pushing.t >= 0.5); n++) update(1 / 60, true);
    phase = 'hold';
    clock = 0;
  }

  // ---------------------------------------------------------------- loop and input
  let frame = 0;
  let last = 0;
  let visible = false;
  /** Whether a frame would change nothing: the line is held and every counter has settled. */
  const settled = () => held() && shown.every((n, i) => n.at === target[i] && n.rate === 0);
  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    // Held, nothing moves on its own: each step is shown settled when asked for.
    update(held() ? 0 : dt, held());
    draw();
    frame = visible && !settled() ? requestAnimationFrame(tick) : 0;
  }
  const run = () => {
    if (!frame && visible) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  function next() {
    if (phase === 'done') restart();
    else {
      finishInstantly();
      begin(e + 1);
      if (held() && e < D.steps.length) {
        finishInstantly();
        phase = 'hold';
        update(0, true);
      }
    }
    run();
  }
  function onKey(event) {
    if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') next();
    else if (event.key === 'Home') {
      restart();
      run();
    } else return;
    event.preventDefault();
  }
  // It runs only while the figure is on screen, or about to be.
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: '120px 0px' },
  );
  observer.observe(stage);
  stage.addEventListener('click', next);
  stage.addEventListener('keydown', onKey);
  // The line moves by itself, so it shows a Pause button (WCAG 2.2.2); under reduced motion it
  // never does, and the button stays hidden.
  const pause = root.querySelector('[data-pause]');
  function togglePause() {
    paused = !paused;
    pause.textContent = paused ? 'Play' : 'Pause';
    run();
  }
  if (pause && !still.matches) {
    pause.hidden = false;
    pause.addEventListener('click', togglePause);
  }
  // The stage takes focus and keys only while the tour runs, so a page without it has no dead stop.
  const KEYS = 'Click, or press → or Space, for the next step; Home starts over.';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', `Live tour. ${KEYS}`);
  if (still.matches) {
    poseStill();
    update(0, true);
  } else restart();
  draw();

  return () => {
    cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
    stage.removeEventListener('click', next);
    stage.removeEventListener('keydown', onKey);
    if (pause) {
      pause.removeEventListener('click', togglePause);
      pause.hidden = true;
      pause.textContent = 'Pause';
    }
    stage.removeAttribute('tabindex');
    stage.removeAttribute('role');
    stage.removeAttribute('aria-label');
  };
}
