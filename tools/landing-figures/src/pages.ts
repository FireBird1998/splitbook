// The pages the tooling opens in headless Chrome: a figure at rest, with its live tour, and its
// still at the link preview's size. Each live page runs the same tour bundle as the web app.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as k from './kit.ts';
import { STILL_SIZE, tourScript, type Figure } from './generate.ts';

const DRIVE = resolve(import.meta.dirname, '../vendor/anatomy/scripts/drive.mjs');
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
/** The pages' stand-ins for the web app's visually hidden live region and Pause button. */
const SR_CSS =
  '.fg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
  '.fg-pause{position:absolute;top:44px;right:24px;font:12px var(--anatomy-mono);color:var(--anatomy-text);background:none;border:0;cursor:pointer}';

/**
 * Runs actions on a page in headless Chrome, with reduced motion unless `moving`, and returns what
 * it printed. `preload` names a script that runs before the page's own; `timeout` bounds the run.
 */
export function drive(
  file: string,
  actions: unknown[],
  {
    moving = false,
    preload,
    timeout = 120_000,
  }: { moving?: boolean; preload?: string; timeout?: number } = {},
): string {
  const args = [DRIVE, file, JSON.stringify(actions)];
  if (!moving) args.push('--reduced');
  if (preload) args.push('--preload', preload);
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout });
  return `${run.stdout}${run.stderr}${run.error ? `\n${run.error.message}` : ''}`;
}

/**
 * A script for `drive`'s preload that watches a live tour play by itself, after every frame it
 * draws. It keeps each counter reading that changed, what each reads and where it is heading
 * (drawCounters' `data-target`) in whole rupees. It notes the tour has gone round once when the
 * plate's readout comes back to where it started, and what the plate and the live region say in
 * that frame, as the tour starts over.
 */
export const TOUR_SAMPLER = `(() => {
  const frames = [];
  let drawn = 0, last = '', first = null, moved = false, round = false, restart = null;
  const rupees = (text) => Number(text.replace('\u2212', '-').replace(/[+,]/g, ''));
  const read = () => {
    if (round) return;
    drawn += 1;
    const counters = [...document.querySelectorAll('[data-count][data-target]')];
    if (counters.length) {
      const shown = counters.map((el) => rupees(el.textContent));
      const target = counters.map((el) => Number(el.dataset.target));
      // Only readings that changed are kept, numbered by the frame they were drawn in.
      const key = JSON.stringify([shown, target]);
      if (key !== last) frames.push({ frame: drawn, shown, target });
      last = key;
    }
    const readout = document.querySelector('[data-readout]')?.textContent ?? '';
    if (first === null) first = readout;
    else if (readout !== first) moved = true;
    else if (moved) {
      round = true;
      restart = { readout, status: document.querySelector('[data-status]')?.textContent ?? '' };
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf((now) => { callback(now); read(); });
  window.__tour = { frames, round: () => round, restart: () => restart };
})();`;

/**
 * A script for `drive`'s eval that steps a live tour as a keyboard visitor would: it presses each
 * key on the stage, reads the plate's readout and the live region at once, the moment the step has
 * written them, then lets the tour draw two frames before the next key. It returns those readings,
 * each with what the live region said just before its key.
 */
export const keyStepper = (keys: readonly string[]) => `(async () => {
  const stage = document.querySelector('[data-stage]');
  const status = stage.querySelector('[data-status]');
  const readout = document.querySelector('[data-readout]');
  const frames = (n) => new Promise((done) => {
    const go = (left) => (left ? requestAnimationFrame(() => go(left - 1)) : done());
    go(n);
  });
  await frames(2);
  const steps = [];
  for (const key of ${JSON.stringify(keys)}) {
    const before = status.textContent;
    stage.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    steps.push({ key, readout: readout.textContent, status: status.textContent, before });
    await frames(2);
  }
  return steps;
})()`;

/**
 * A script for `drive`'s eval that plays a live tour on after a keyboard visitor paused it (#570).
 * From the restart (Home), paused, it counts the → presses that come round to the restart again.
 * Then for each count short of that: Home, Pause, that many →, Play, and it watches whether the
 * readout moves on by itself and comes back to the restart. It starts the run and returns at
 * once; `window.__resume` holds `{ done, result }`, for an `until`.
 */
export const RESUME_STEPPER = `(() => {
  const stage = document.querySelector('[data-stage]');
  const readout = document.querySelector('[data-readout]');
  const pause = document.querySelector('[data-pause]');
  const frames = (n) => new Promise((done) => {
    const go = (left) => (left ? requestAnimationFrame(() => go(left - 1)) : done());
    go(n);
  });
  const until = async (test, most) => {
    for (let n = 0; n < most && !test(); n++) await frames(1);
    return test();
  };
  const press = async (key) => {
    stage.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await frames(2);
  };
  // Up to ten seconds for the next step, a minute to come round.
  const STEP_FRAMES = 600;
  const ROUND_FRAMES = 3600;
  window.__resume = { done: false };
  (async () => {
    await frames(2);
    await press('Home');
    const restart = readout.textContent;
    pause.click();
    let round = 0;
    for (let n = 1; n <= 12 && !round; n++) {
      await press('ArrowRight');
      if (readout.textContent === restart) round = n;
    }
    pause.click();
    const rounds = [];
    for (let presses = 1; presses < round; presses++) {
      await press('Home');
      pause.click();
      for (let n = 0; n < presses; n++) await press('ArrowRight');
      const at = readout.textContent;
      pause.click();
      const movedOn = await until(() => readout.textContent !== at, STEP_FRAMES);
      const startedOver = movedOn && (await until(() => readout.textContent === restart, ROUND_FRAMES));
      rounds.push({ presses, at, movedOn, startedOver });
    }
    window.__resume = { done: true, result: { restart, rounds } };
  })();
  return 'started';
})()`;

/** What a drive run's last `eval` returned, or undefined when the run stopped before it. */
export function evalResult<T>(out: string): T | undefined {
  const line = out
    .split('\n')
    .filter((l) => l.startsWith('eval: '))
    .at(-1);
  return line === undefined ? undefined : (JSON.parse(line.slice('eval: '.length)) as T);
}

/** Whether a drive run's page logged no errors or exceptions. */
export const cleanConsole = (out: string) => out.includes('console: clean');

function page(figure: Figure, theme: Theme, body: string, script?: string) {
  return k.pageHtml({
    title: figure.title,
    theme,
    body: `<style>${figure.css}${SR_CSS}</style>${body}`,
    script,
    width: Math.max(figure.width + 60, STILL_SIZE.width),
  });
}

/**
 * The live stage: the drawing at rest and the live region the tour announces each step in. The
 * web app's LandingFigure gives the tour the same hooks.
 */
const stage = (figure: Figure) =>
  `<div class="iso-stage" data-stage>${figure.svg}<span class="fg-sr" role="status" aria-live="polite" data-status></span></div>`;

/** A figure in its card, without the live script: the drawing exactly as the page first paints it. */
export function restPage(figure: Figure, theme: Theme) {
  const plate = k.plateHtml({
    fig: `Fig ${figure.number}`,
    title: figure.title,
    body: `<div class="iso-stage">${figure.svg}</div>`,
  });
  return page(figure, theme, plate);
}

/** The figure with its live tour. */
export function livePage(figure: Figure, theme: Theme) {
  const plate = k.plateHtml({
    fig: `Fig ${figure.number}`,
    title: figure.title,
    hint: 'Click or → for the next step',
    readout: figure.readout,
    body: `<button type="button" class="fg-pause" data-pause hidden>Pause</button>${stage(figure)}`,
  });
  return page(figure, theme, plate, tourScript(figure, 'iife'));
}

/** The light still on its own (`.og`), at the link preview's size, for `build` to photograph. */
export function linkPreviewPage(figure: Figure) {
  const { width, height } = STILL_SIZE;
  const box = `<div class="og" style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;background:var(--anatomy-paper)"><figure class="iso-figure" style="margin:0;width:${width - 72}px">${stage(figure)}<span data-readout hidden></span></figure></div>`;
  return page(figure, 'light', box, tourScript(figure, 'iife'));
}
