// pnpm --filter @splitbook/landing-figures <build | check | preview [dir]>
//   build    regenerate the figures into the web app
//   check    fail on stale output, a story that doesn't balance, an edited vendored kit, or any audit
//            or line-end problem
//   preview  write each figure as an interactive page (light and dark) to look at in a browser
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as k from './kit.ts';
import { staleOutputs, vendorDrift, verifyStory } from './check.ts';
import { OUT_DIR, buildFigures, generatedFiles, type Figure } from './generate.ts';
import { story } from './story.ts';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '../../..');
const VENDOR = resolve(HERE, '../vendor/anatomy');
const DRIVE = join(VENDOR, 'scripts/drive.mjs');
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const BUILD = '`pnpm --filter @splitbook/landing-figures build`';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function build() {
  const files = generatedFiles(buildFigures());
  for (const path of staleOutputs(files, ROOT, OUT_DIR)) {
    if (!files.has(path)) rmSync(join(ROOT, path));
  }
  for (const [path, text] of files) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), text);
  }
  console.log(`wrote ${[...files.keys()].join(', ')}`);
}

function page(figure: Figure, theme: Theme, plate: string, script?: string) {
  return k.pageHtml({
    title: figure.title,
    theme,
    body: `<style>${figure.css}</style>${plate}`,
    script,
    width: figure.width + 60,
  });
}

/** A figure in its card, without the live script: the drawing exactly as the page first paints it. */
function stillPage(figure: Figure, theme: Theme) {
  const plate = k.plateHtml({
    fig: figure.title,
    title: figure.title,
    body: `<div class="iso-stage">${figure.svg}</div>`,
  });
  return page(figure, theme, plate);
}

/** The figure with its reference live tour: click, or → / Space / Enter, for the next step. */
function livePage(figure: Figure, theme: Theme) {
  const kit = readFileSync(join(VENDOR, 'kit/iso-kit.mjs'), 'utf8').replace(/^export /gm, '');
  const tour = readFileSync(resolve(HERE, `figures/${figure.id}.tour.js`), 'utf8').replace(
    '__DATA__',
    JSON.stringify(figure.tour),
  );
  const plate = k.plateHtml({
    fig: 'Fig',
    title: figure.title,
    hint: 'Click or → for the next step',
    body: `<div class="iso-stage ln-stage fg-stage" tabindex="0" role="group" aria-label="${figure.title}">${figure.svg}<span class="fg-sr" role="status" aria-live="polite" data-status></span></div>`,
  });
  return page(figure, theme, plate, kit + tour);
}

/**
 * Runs the kit's line-end check on a page in headless Chrome with reduced motion, once per pose,
 * pressing → between poses. With reduced motion the live tour opens with every Expense split, and
 * → then shows the finished line, the idle line, and each Expense in turn without animation.
 */
function floatingEnds(file: string, poses: number): { floating: number[]; out: string } {
  const lines = ['lines', null, null, { tolerance: 1 }];
  const actions: unknown[] = [['wait', 1500], lines];
  for (let i = 1; i < poses; i++) actions.push(['key', 'ArrowRight'], ['wait', 300], lines);
  const run = spawnSync(process.execPath, [DRIVE, file, JSON.stringify(actions), '--reduced'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  const out = `${run.stdout}${run.stderr}${run.error ? `\n${run.error.message}` : ''}`;
  const floating = [...out.matchAll(/line ends: (\d+) of/g)].map((match) => Number(match[1]));
  return { floating, out };
}

function lineEnds(figures: Figure[]): string[] {
  const problems: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'landing-figures-'));
  try {
    for (const figure of figures) {
      const steps = (figure.tour as { steps: unknown[] }).steps.length;
      for (const theme of THEMES) {
        const pages = [
          { name: 'at rest', html: stillPage(figure, theme), poses: 1 },
          // every Expense split, finished, idle, then each Expense before the last
          { name: 'live tour', html: livePage(figure, theme), poses: steps + 2 },
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
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return problems;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function check() {
  const figures = buildFigures();
  const problems: string[] = [];
  const stale = staleOutputs(generatedFiles(figures), ROOT, OUT_DIR);
  if (stale.length) problems.push(`Stale output, run ${BUILD}: ${stale.join(', ')}`);
  problems.push(...verifyStory(story()));
  problems.push(...vendorDrift(VENDOR).map((problem) => `vendor/anatomy: ${problem}`));
  for (const figure of figures) {
    const result = k.audit(figure.recorder, figure.projection);
    const found = k.failures(result);
    if (found)
      problems.push(`${figure.id}: audit found ${count(found, 'problem')}.\n${k.report(result)}`);
  }
  problems.push(...lineEnds(figures));
  if (problems.length) {
    console.error(problems.join('\n\n'));
    console.error(`\ncheck failed: ${count(problems.length, 'problem')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `check passed: ${count(figures.length, 'figure')}, output current, story balanced, vendored kit unchanged, audit and line ends clean in light and dark`,
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
