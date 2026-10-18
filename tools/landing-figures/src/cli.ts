// pnpm --filter @splitbook/landing-figures <build | check | preview [dir]>
//   build    regenerate the figures into the web app, and draw each still that is out of date
//   check    fail on stale output or stills, a story that doesn't balance, an edited vendored kit,
//            any audit, line-end or console problem, a counter that is untrue in any frame, or a
//            step, by keyboard or as a tour starts over, that the live region doesn't announce as
//            drawn, or a tour that stalls when played on after Pause and →
//   preview  write each figure as an interactive page (light and dark) to look at in a browser
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as k from './kit.ts';
import {
  counterProblems,
  resumeProblems,
  staleOutputs,
  statusProblems,
  stillDrift,
  vendorDrift,
  verifyStory,
  saysWhatIsDrawn,
  type CounterFrame,
  type Reading,
  type ResumeRound,
  type StatusStep,
} from './check.ts';
import {
  OUT_DIR,
  STILL_SIZE,
  buildFigures,
  generatedFiles,
  stillPath,
  withStills,
  type Figure,
} from './generate.ts';
import {
  RESUME_STEPPER,
  THEMES,
  TOUR_SAMPLER,
  cleanConsole,
  drive,
  evalResult,
  keyStepper,
  livePage,
  restPage,
} from './pages.ts';
import { drawStills, stillSource } from './stills.ts';
import { story } from './story.ts';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '../../..');
const VENDOR = resolve(HERE, '../vendor/anatomy');
const BUILD = '`pnpm --filter @splitbook/landing-figures build`';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function build() {
  const figures = buildFigures();
  const files = generatedFiles(figures);
  drawStills(figures, ROOT);
  for (const path of staleOutputs(files, ROOT, OUT_DIR)) {
    if (!files.has(path)) rmSync(join(ROOT, path));
  }
  for (const [path, text] of files) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), text);
  }
  console.log(`wrote ${[...files.keys()].join(', ')}`);
}

/**
 * Runs the kit's line-end check on a page with reduced motion, once per pose, pressing → between
 * poses, and requires a clean console.
 */
function floatingEnds(file: string, poses: number): { floating: number[]; out: string } {
  const lines = ['lines', null, null, { tolerance: 1 }];
  const actions: unknown[] = [['wait', 1500], lines];
  for (let i = 1; i < poses; i++) actions.push(['key', 'ArrowRight'], ['wait', 300], lines);
  const out = drive(file, actions);
  const floating = [...out.matchAll(/line ends: (\d+) of/g)].map((match) => Number(match[1]));
  return { floating, out };
}

/** Runs `use` in a fresh temporary folder, and removes the folder after. */
function inTempDir<T>(prefix: string, use: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lineEnds(figures: Figure[]): string[] {
  return inTempDir('landing-figures-', (dir) => {
    const problems: string[] = [];
    for (const figure of figures) {
      for (const theme of THEMES) {
        const pages = [
          { name: 'at rest', html: restPage(figure, theme), poses: 1 },
          // With reduced motion the tour opens on its still; → then shows each of its other poses.
          { name: 'live tour', html: livePage(figure, theme), poses: figure.poses },
        ];
        for (const { name, html, poses } of pages) {
          const file = join(dir, `${figure.id}-${theme}.html`);
          writeFileSync(file, html);
          const { floating, out } = floatingEnds(file, poses);
          const where = `${figure.id} (${theme}, ${name})`;
          if (floating.length !== poses)
            problems.push(`${where}: the line-end check did not run.\n${out.trim()}`);
          else if (floating.some(Boolean))
            problems.push(`${where}: ${count(sum(floating), 'line end')} float.\n${out.trim()}`);
          if (!cleanConsole(out)) problems.push(`${where}: the page logged errors.\n${out.trim()}`);
        }
      }
    }
    return problems;
  });
}

/**
 * Plays each tour once round by itself, with motion, watching every frame it draws. Its counters,
 * if it has any, must add up to zero and never pass where they are heading (#511); as it starts
 * over, its live region must say what the plate reads (#568).
 */
function playingByItself(figures: Figure[]): string[] {
  return inTempDir('landing-round-', (dir) => {
    const problems: string[] = [];
    const sampler = join(dir, 'sampler.js');
    writeFileSync(sampler, TOUR_SAMPLER);
    for (const figure of figures) {
      const file = join(dir, `${figure.id}.html`);
      writeFileSync(file, livePage(figure, 'light'));
      // Twice real time: the tours step at most 1/30 s a frame, so every step is still drawn.
      const out = drive(
        file,
        [
          ['slow', 2],
          ['until', 'window.__tour.round()', 180_000],
          ['eval', '({ frames: window.__tour.frames, restart: window.__tour.restart() })'],
        ],
        // A tour takes up to half a minute to go round at this speed.
        { moving: true, preload: sampler, timeout: 240_000 },
      );
      const where = `${figure.id} (live tour, every frame)`;
      const round = evalResult<{ frames: CounterFrame[]; restart: Reading }>(out);
      if (!round) {
        problems.push(`${where}: the tour did not go round.\n${out.trim()}`);
        continue;
      }
      if ('counters' in figure)
        problems.push(
          ...counterProblems(round.frames, figure.counters).map(
            (problem) => `${where}: ${problem}`,
          ),
        );
      if (!saysWhatIsDrawn(round.restart))
        problems.push(
          `${where}: starting over, the live region says "${round.restart.status}", but the plate reads "${round.restart.readout}".`,
        );
      if (!cleanConsole(out)) problems.push(`${where}: the page logged errors.\n${out.trim()}`);
    }
    return problems;
  });
}

// More than twice round the longest tour (Fig 3 moving, six steps), then Home. statusProblems
// fails a run whose → presses never come round to the restart.
const STEP_KEYS = [...Array.from({ length: 13 }, () => 'ArrowRight'), 'Home'];

/**
 * Steps each tour by keyboard, held (reduced motion) and moving, from where it opens, and reads
 * its live region after every key: it must tell each step as drawn (#568).
 */
function statusAtEveryStep(figures: Figure[]): string[] {
  return inTempDir('landing-status-', (dir) => {
    const problems: string[] = [];
    for (const figure of figures) {
      const file = join(dir, `${figure.id}.html`);
      writeFileSync(file, livePage(figure, 'light'));
      for (const moving of [false, true]) {
        const out = drive(file, [['eval', keyStepper(STEP_KEYS)]], { moving });
        const where = `${figure.id} (live tour, ${moving ? 'moving' : 'held'}, by keyboard)`;
        const steps = evalResult<StatusStep[]>(out);
        if (!steps) {
          problems.push(`${where}: the tour could not be stepped.\n${out.trim()}`);
          continue;
        }
        problems.push(...statusProblems(steps).map((problem) => `${where}: ${problem}`));
        if (!cleanConsole(out)) problems.push(`${where}: the page logged errors.\n${out.trim()}`);
      }
    }
    return problems;
  });
}

/**
 * Plays each tour on after Pause and → from every step → reaches (#570), at twice real time: it
 * must move on by itself and come round to its restart.
 */
function resumingAfterSteps(figures: Figure[]): string[] {
  return inTempDir('landing-resume-', (dir) => {
    const problems: string[] = [];
    for (const figure of figures) {
      const file = join(dir, `${figure.id}.html`);
      writeFileSync(file, livePage(figure, 'light'));
      const out = drive(
        file,
        [
          ['slow', 2],
          ['eval', RESUME_STEPPER],
          ['until', 'window.__resume.done', 240_000],
          ['eval', 'window.__resume.result'],
        ],
        { moving: true, timeout: 300_000 },
      );
      const where = `${figure.id} (live tour, played on after Pause and →)`;
      const run = evalResult<{ restart: string; rounds: ResumeRound[] }>(out);
      if (!run) {
        problems.push(`${where}: the tour could not be played on.\n${out.trim()}`);
        continue;
      }
      problems.push(...resumeProblems(run).map((problem) => `${where}: ${problem}`));
      if (!cleanConsole(out)) problems.push(`${where}: the page logged errors.\n${out.trim()}`);
    }
    return problems;
  });
}

function check() {
  const figures = buildFigures();
  const problems: string[] = [];
  const stale = staleOutputs(generatedFiles(figures), ROOT, OUT_DIR);
  if (stale.length) problems.push(`Stale output, run ${BUILD}: ${stale.join(', ')}`);
  for (const figure of withStills(figures))
    problems.push(
      ...stillDrift(join(ROOT, stillPath(figure)), STILL_SIZE, stillSource(figure)).map(
        (problem) => `${problem} Run ${BUILD}.`,
      ),
    );
  problems.push(...verifyStory(story()));
  problems.push(...vendorDrift(VENDOR).map((problem) => `vendor/anatomy: ${problem}`));
  for (const figure of figures) {
    const result = k.audit(figure.recorder, figure.projection);
    const found = k.failures(result);
    if (found)
      problems.push(`${figure.id}: audit found ${count(found, 'problem')}.\n${k.report(result)}`);
  }
  problems.push(...lineEnds(figures));
  problems.push(...playingByItself(figures));
  problems.push(...statusAtEveryStep(figures));
  problems.push(...resumingAfterSteps(figures));
  if (problems.length) {
    console.error(problems.join('\n\n'));
    console.error(`\ncheck failed: ${count(problems.length, 'problem')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `check passed: ${count(figures.length, 'figure')}, output and stills current, story balanced, vendored kit unchanged, audit, line ends and console clean in light and dark, counters true in every frame, every step announced as drawn, every tour plays on after Pause`,
    );
  }
}

function preview(out: string) {
  mkdirSync(out, { recursive: true });
  for (const figure of buildFigures()) {
    for (const theme of THEMES) {
      const file = join(out, `${figure.id}-${theme}.html`);
      writeFileSync(file, livePage(figure, theme));
      console.log(`wrote ${file}`);
    }
  }
}

const [command, arg] = process.argv.slice(2);
if (command === 'build') build();
else if (command === 'check') check();
else if (command === 'preview') preview(resolve(arg ?? join(tmpdir(), 'landing-figures-preview')));
else {
  console.error('usage: cli.ts <build | check | preview [dir]>');
  process.exitCode = 2;
}
