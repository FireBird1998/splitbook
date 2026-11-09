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
 * Historical link-preview stage. Keep this recipe intact: it determines the PNG source stamp.
 */
const stage = (figure: Figure) =>
  `<div class="iso-stage" data-stage>${figure.svg}<span class="fg-sr" role="status" aria-live="polite" data-status></span></div>`;

/** The light still on its own (`.og`), at the link preview's size, for `build` to photograph. */
export function linkPreviewPage(figure: Figure) {
  const { width, height } = STILL_SIZE;
  const box = `<div class="og" style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;background:var(--anatomy-paper)"><figure class="iso-figure" style="margin:0;width:${width - 72}px">${stage(figure)}<span data-readout hidden></span></figure></div>`;
  return page(figure, 'light', box, tourScript(figure, 'iife'));
}
