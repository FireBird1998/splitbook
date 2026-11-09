// pnpm --filter @splitbook/landing-figures <build | check | preview [dir]>
//   build    regenerate the figures into the web app, and draw each still that is out of date
//   check    stale output/stills, story, audit, line ends, counters and quiet playback
//   preview  write each figure as an interactive page (light and dark) to look at in a browser
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  withStills,
} from './generate.ts';
import { THEMES } from './pages.ts';
import { drawStills, stillSource } from './stills.ts';
import { story } from './story.ts';
import { quietProblems } from './quiet-check.ts';
import { quietPage } from './quiet.ts';
import {
  drawQuietStills,
  quietStillSource,
  quietStillPath,
  quietStillSize,
} from './quiet-stills.ts';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '../../..');
const VENDOR = resolve(HERE, '../vendor/anatomy');
const BUILD = '`pnpm --filter @splitbook/landing-figures build`';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function build() {
  const figures = buildFigures();
  const files = generatedFiles(figures);
  drawStills(figures, ROOT);
  drawQuietStills(figures, ROOT);
  for (const path of staleOutputs(files, ROOT, OUT_DIR)) {
    if (!files.has(path)) rmSync(join(ROOT, path));
  }
  for (const [path, text] of files) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), text);
  }
  console.log(`wrote ${[...files.keys()].join(', ')}`);
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
  for (const figure of figures)
    for (const theme of THEMES)
      problems.push(
        ...stillDrift(
          join(ROOT, quietStillPath(figure, theme)),
          quietStillSize(figure),
          quietStillSource(figure, theme),
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
  problems.push(...quietProblems(figures));
  if (problems.length) {
    console.error(problems.join('\n\n'));
    console.error(`\ncheck failed: ${count(problems.length, 'problem')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `check passed: ${count(figures.length, 'figure')}, output and stills current, story balanced, vendored kit unchanged, audit, line ends and console clean in light and dark, counters true in every frame, quiet tours autoplay at 0.6×, pause/resume and ignore stepping`,
    );
  }
}

function preview(out: string) {
  mkdirSync(out, { recursive: true });
  for (const figure of buildFigures()) {
    for (const theme of THEMES) {
      const quiet = join(out, `${figure.id}-quiet-${theme}.html`);
      writeFileSync(quiet, quietPage(figure, theme));
      console.log(`wrote ${quiet}`);
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
