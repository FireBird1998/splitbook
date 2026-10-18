// What every figure's live tour shares. A figure's scene moves its own story; this runs it on the
// plate in the page, a frame at a time while the figure is on screen, holds it under reduced
// motion or while paused, and wires clicks, keys and the Pause button. The web app and the
// preview pages run it bundled with each figure's scene.

const KEYS = 'Click, or press → or Space, for the next step; Home starts over.';

/**
 * Runs a figure's scene on its plate (root): the stage (`[data-stage]`) with the figure's SVG at
 * rest and a `[data-status]` live region, a `[data-readout]`, and the plate's `[data-pause]`
 * button, if it has one.
 *
 * makeScene gets the SVG, `held()` (reduced motion or paused: nothing moves by itself, and each
 * step shows settled), `say(text)` for the readout, `announce(text)` for the live region and
 * `tell(text)` for both. Every step a visitor can reach, starting over included, tells what it
 * shows, so the live region never describes a state the drawing has left (#568); only a beat
 * within a step may just say it. It returns the scene: `restart()`, `next()`, `update(dt, calm)`,
 * `draw()`, `poseStill()` (the documented still, where the tour opens under reduced motion) and
 * `settled()` (nothing left to move while held).
 *
 * Returns a function that stops the tour and leaves the drawing as it is.
 */
export function runTour(root, makeScene) {
  const stage = root.querySelector('[data-stage]');
  const readout = root.querySelector('[data-readout]');
  const status = stage.querySelector('[data-status]');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  const held = () => still.matches || paused;
  const say = (text) => {
    if (readout && readout.textContent !== text) readout.textContent = text;
  };
  const announce = (text) => {
    if (status) status.textContent = text;
  };
  const scene = makeScene({
    svg: stage.querySelector('svg'),
    held,
    say,
    announce,
    tell(text) {
      say(text);
      announce(text);
    },
  });

  let frame = 0;
  let last = 0;
  let visible = false;
  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    // Held, nothing moves on its own: each step is shown settled when asked for.
    scene.update(held() ? 0 : dt, held());
    scene.draw();
    frame = visible && !(held() && scene.settled()) ? requestAnimationFrame(tick) : 0;
  }
  const run = () => {
    if (!frame && visible) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  function next() {
    scene.next();
    run();
  }
  function onKey(event) {
    if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') next();
    else if (event.key === 'Home') {
      scene.restart();
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
  // The figure moves by itself, so it shows a Pause button (WCAG 2.2.2); under reduced motion it
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
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', `Live tour. ${KEYS}`);
  if (still.matches) {
    scene.poseStill();
    scene.update(0, true);
  } else scene.restart();
  scene.draw();

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

// ---------------------------------------------------------------- what every scene draws with
export const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const lerp = (a, b, t) => a + (b - a) * t;
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** Whole rupees: ₹1,200. */
export const rupees = (minor) => '₹' + inr.format(Math.abs(minor / 100));
/** Whole rupees with their sign, as a counter reads them: +500, −700, 0. */
export const signed = (minor) => {
  const v = Math.round(minor / 100);
  return v === 0 ? '0' : (v > 0 ? '+' : '−') + inr.format(Math.abs(v));
};

// How long a counter takes to move an amount to another.
const SHIFT_SECONDS = 0.5;

/**
 * The counters' readings, in minor units. Money only ever moves between two counters:
 * `raiseAndLower` raises one and lowers the other by the same amount, eased over a moment in whole
 * rupees. So in
 * every frame the readings add up to what they did before, and each moves only toward where it is
 * heading, never past it.
 */
export function counterReadings(count) {
  let at = Array.from({ length: count }, () => 0);
  let shifts = [];
  const moved = (s) => Math.round((s.amountMinor / 100) * ease(s.t / SHIFT_SECONDS)) * 100;
  const apply = (amountOf) =>
    at.map((value, i) =>
      shifts.reduce(
        (sum, s) => sum + (s.up === i ? amountOf(s) : s.down === i ? -amountOf(s) : 0),
        value,
      ),
    );
  return {
    /** What each counter reads now. */
    get shown() {
      return apply(moved);
    },
    /** Where each counter is heading: its reading once every move has finished. */
    get targets() {
      return apply((s) => s.amountMinor);
    },
    /** Shows these readings at once, with nothing moving. */
    jump(values) {
      at = values.slice();
      shifts = [];
    },
    /** Starts raising counter `up` and lowering counter `down`, each by amountMinor. */
    raiseAndLower(up, down, amountMinor) {
      if (up !== down && amountMinor) shifts.push({ up, down, amountMinor, t: 0 });
    },
    /** Moves on by dt seconds; calm finishes every move at once. */
    step(dt, calm) {
      for (const s of shifts) s.t = calm ? SHIFT_SECONDS : Math.min(SHIFT_SECONDS, s.t + dt);
      for (const s of shifts.filter((s) => s.t >= SHIFT_SECONDS)) {
        at[s.up] += s.amountMinor;
        at[s.down] -= s.amountMinor;
      }
      shifts = shifts.filter((s) => s.t < SHIFT_SECONDS);
    },
    /** Nothing is moving. */
    settled: () => shifts.length === 0,
  };
}

/**
 * Writes each counter's reading, signed, marks its sign for the ink, and notes where it is heading
 * (in rupees), which check reads frame by frame.
 */
export function drawCounters(elements, readings) {
  const { shown, targets } = readings;
  elements.forEach((el, i) => {
    const text = signed(shown[i]);
    if (el.textContent !== text) el.textContent = text;
    const v = Math.round(shown[i] / 100);
    el.dataset.sign = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    el.dataset.target = String(Math.round(targets[i] / 100));
  });
}
