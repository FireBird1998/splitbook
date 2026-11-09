// Browser checks exercise the shipped quiet bundles, not an alternate scene or a stepping API.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { counterProblems, type CounterFrame } from './check.ts';
import type { Figure } from './generate.ts';
import { THEMES, cleanConsole, drive, evalResult } from './pages.ts';
import { quietPage } from './quiet.ts';
import { QUIET_TOUR_SPEED } from './quiet-tour.ts';

/** A deterministic browser frame clock: real scenes still draw and every counter frame is read. */
const CLOCK = `(() => {
  let id = 0, time = 0, drawn = 0, last = '';
  const pending = new Map(), frames = [];
  window.requestAnimationFrame = cb => { pending.set(++id, cb); return id; };
  window.cancelAnimationFrame = id => pending.delete(id);
  window.quietClock = {
    frames,
    pending: () => pending.size,
    advance(count) {
      for (let i = 0; i < count; i++) {
        const callbacks = [...pending.values()]; pending.clear(); time += 1000 / 60;
        for (const cb of callbacks) {
          cb(time); drawn++;
          const counters = [...document.querySelectorAll('[data-count][data-target]')];
          if (!counters.length) continue;
          const shown = counters.map(el => Number(el.textContent.replace('−', '-').replace(/[+,]/g, '')));
          const target = counters.map(el => Number(el.dataset.target));
          const key = JSON.stringify([shown, target]);
          if (key !== last) frames.push({ frame: drawn, shown, target });
          last = key;
        }
      }
    }
  };
})();`;

const PLAYBACK = `(async () => {
  const root = document.querySelector('[data-quiet]'), stage = root.querySelector('[data-stage]');
  const clock = window.quietClock, tour = window.quietTour;
  const problems = [];
  const same = (before, message) => { if (stage.innerHTML !== before) problems.push(message); };
  const inputs = () => {
    stage.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    for (const key of ['ArrowRight', ' ', 'Enter', 'Home']) stage.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
  };
  const initial = stage.innerHTML;
  inputs(); same(initial, 'stepping input changed the quiet scene');
  if (!clock.pending()) problems.push('did not autoplay on screen');
  clock.advance(600);
  if (initial === stage.innerHTML) problems.push('autoplay did not draw a new scene');
  tour.setPaused(true);
  const paused = stage.innerHTML;
  if (clock.pending()) problems.push('paused tour still schedules frames');
  clock.advance(120); inputs(); same(paused, 'pause or input moved the scene');
  tour.setPaused(false); clock.advance(600);
  if (paused === stage.innerHTML) problems.push('resume did not continue');
  root.style.transform = 'translateY(20000px)';
  await new Promise(resolve => setTimeout(resolve, 100));
  const hidden = stage.innerHTML;
  if (clock.pending()) problems.push('offscreen tour still schedules frames');
  clock.advance(120); same(hidden, 'offscreen tour moved');
  root.style.transform = '';
  await new Promise(resolve => setTimeout(resolve, 100));
  clock.advance(12000);
  if (document.querySelector('[aria-live],[tabindex],[data-readout],button')) problems.push('quiet figure has controls or live narration');
  return {problems, frames: clock.frames};
})()`;
const REDUCED = `(() => {
  const before = document.querySelector('[data-stage]').innerHTML;
  window.quietTour.setPaused(false); window.quietClock.advance(600);
  return {idle: window.quietClock.pending() === 0 && before === document.querySelector('[data-stage]').innerHTML};
})()`;

/** Quiet still and timed-pose line ends in both palettes; playback, input and money invariants. */
export function quietProblems(figures: Figure[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'quiet-check-'));
  const problems: string[] = [];
  if (QUIET_TOUR_SPEED !== 0.6)
    problems.push('Quiet tours must use the approved 0.6× story clock.');
  try {
    const preload = join(dir, 'clock.js');
    writeFileSync(preload, CLOCK);
    for (const figure of figures)
      for (const theme of THEMES) {
        const where = `${figure.id} (quiet ${theme})`;
        const file = join(dir, `${figure.id}-${theme}.html`);
        writeFileSync(file, quietPage(figure, theme));
        const still = drive(
          file,
          [
            ['eval', REDUCED],
            ['lines', null, '[data-stage]', { tolerance: 1 }],
          ],
          { preload },
        );
        if (!evalResult<{ idle: boolean }>(still)?.idle)
          problems.push(`${where}: reduced motion scheduled or changed a frame`);
        if (!still.includes('line ends: 0 of') || !cleanConsole(still))
          problems.push(`${where}: reduced-motion line ends or console failed\n${still}`);
        const actions: unknown[] =
          theme === 'light'
            ? [
                ['eval', PLAYBACK],
                ['wait', 100],
              ]
            : [];
        // Check line ends throughout ordinary timed playback, without exposing a stepping API.
        for (let i = 0; i < figure.poses; i++)
          actions.push(
            ['eval', 'window.quietClock.advance(480); null'],
            ['lines', null, '[data-stage]', { tolerance: 1 }],
          );
        // Keep the structured result last, after the line-end reports.
        if (theme === 'light') {
          actions[0] = [
            'eval',
            `(async () => { window.quietResult = await ${PLAYBACK}; return null; })()`,
          ];
          actions.push(['eval', 'window.quietResult'], ['wait', 100]);
        }
        const out = drive(file, actions, { moving: true, preload, timeout: 240_000 });
        const floating = [...out.matchAll(/line ends: (\d+) of/g)].map((match) => Number(match[1]));
        if (floating.length !== figure.poses || floating.some(Boolean) || !cleanConsole(out))
          problems.push(`${where}: moving line ends or console failed\n${out}`);
        if (theme === 'light') {
          const result = evalResult<{ problems: string[]; frames: CounterFrame[] }>(out);
          if (!result) problems.push(`${where}: playback check did not finish\n${out}`);
          else {
            problems.push(...result.problems.map((p) => `${where}: ${p}`));
            if ('counters' in figure)
              problems.push(
                ...counterProblems(result.frames, figure.counters).map((p) => `${where}: ${p}`),
              );
          }
        }
      }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return problems;
}
