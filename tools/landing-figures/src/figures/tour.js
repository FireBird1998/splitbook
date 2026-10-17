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
 * step shows settled), `say(text)` for the readout and `announce(text)` for the live region. It
 * returns the scene: `restart()`, `next()`, `update(dt, calm)`, `draw()`, `poseStill()` (the
 * documented still, where the tour opens under reduced motion) and `settled()` (nothing left to
 * move while held).
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
  const scene = makeScene({
    svg: stage.querySelector('svg'),
    held,
    say(text) {
      if (readout && readout.textContent !== text) readout.textContent = text;
    },
    announce(text) {
      if (status) status.textContent = text;
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

/** Counter readings on springs: each eases toward its target, or jumps there when calm. */
export function springs(count) {
  const shown = Array.from({ length: count }, () => ({ at: 0, rate: 0 }));
  return {
    shown,
    jump(values) {
      shown.forEach((n, i) => {
        n.at = values[i];
        n.rate = 0;
      });
    },
    step(target, dt, calm) {
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
    },
    /** Every reading has come to rest on its target. */
    settledOn: (target) => shown.every((n, i) => n.at === target[i] && n.rate === 0),
  };
}

/** Writes each counter's reading, signed, and marks its sign for the ink. */
export function drawCounters(elements, shown) {
  elements.forEach((el, i) => {
    const text = signed(shown[i].at);
    if (el.textContent !== text) el.textContent = text;
    const v = Math.round(shown[i].at / 100);
    el.dataset.sign = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
  });
}
