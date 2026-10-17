// pnpm --filter @splitbook/landing-figures <build | check | preview [dir]>
//   build    regenerate the figures into the web app, and draw each still that is out of date
//   check    fail on stale output or stills, a story that doesn't balance, an edited vendored kit,
//            or any audit, line-end or console problem
//   preview  write each figure as an interactive page (light and dark) to look at in a browser
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as k from './kit.ts';
import { staleOutputs, stillDrift, vendorDrift, verifyStory } from './check.ts';
import {
  OUT_DIR,
  STILL_SIZE,
  buildFigures,
  generatedFiles,
  stillPath,
  type Figure,
} from './generate.ts';
import { THEMES, cleanConsole, drive, livePage, restPage } from './pages.ts';
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

function lineEnds(figures: Figure[]): string[] {
  const problems: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'landing-figures-'));
  try {
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return problems;
}

function check() {
  const figures = buildFigures();
  const problems: string[] = [];
  const stale = staleOutputs(generatedFiles(figures), ROOT, OUT_DIR);
  if (stale.length) problems.push(`Stale output, run ${BUILD}: ${stale.join(', ')}`);
  for (const figure of figures)
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
  if (problems.length) {
    console.error(problems.join('\n\n'));
    console.error(`\ncheck failed: ${count(problems.length, 'problem')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `check passed: ${count(figures.length, 'figure')}, output and stills current, story balanced, vendored kit unchanged, audit, line ends and console clean in light and dark`,
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
