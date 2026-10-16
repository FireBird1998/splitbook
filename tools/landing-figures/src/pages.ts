// The pages the tooling opens in headless Chrome: a figure at rest, with its live tour, and its
// still at the link preview's size. Each live page runs the same tour bundle as the web app.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as k from './kit.ts';
import { STILL_SIZE, tourScript, type Figure } from './generate.ts';

const DRIVE = resolve(import.meta.dirname, '../vendor/anatomy/scripts/drive.mjs');
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
/** The pages' stand-in for the web app's visually hidden live region. */
const SR_CSS = '.fg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}';

/** Runs actions on a page in headless Chrome with reduced motion, and returns what it printed. */
export function drive(file: string, actions: unknown[]): string {
  const run = spawnSync(process.execPath, [DRIVE, file, JSON.stringify(actions), '--reduced'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  return `${run.stdout}${run.stderr}${run.error ? `\n${run.error.message}` : ''}`;
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
  `<div class="iso-stage ln-stage">${figure.svg}<span class="fg-sr" role="status" aria-live="polite" data-status></span></div>`;

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
    body: stage(figure),
  });
  return page(figure, theme, plate, tourScript(figure, 'iife'));
}

/** The light still on its own (`.og`), at the link preview's size, for `build` to photograph. */
export function linkPreviewPage(figure: Figure) {
  const { width, height } = STILL_SIZE;
  const box = `<div class="og" style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;background:var(--anatomy-paper)"><figure class="iso-figure" style="margin:0;width:${width - 72}px">${stage(figure)}<span data-readout hidden></span></figure></div>`;
  return page(figure, 'light', box, tourScript(figure, 'iife'));
}
