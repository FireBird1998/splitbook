import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Box from '@mui/material/Box';
import { describe, expect, it } from 'vitest';
import { scrollBoxes } from '@/lib/test-utils/markup';
import { visuallyHidden } from './visually-hidden';
import { scrollBox } from './scroll-box';

/*
 * #946: visually hidden text is position: absolute. In a scroll box with no position it keeps
 * its place past the box's right edge, and in a table wider than the screen it widened the
 * whole page: at 390 px, Maple House's Balances scrolled 478 px sideways (#944). So every box
 * that scrolls sideways is positioned, by spreading the shared `scrollBox`.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

describe('the shared scroll box (#946)', () => {
  it('scrolls sideways and keeps the hidden text inside it', () => {
    const html = renderToStaticMarkup(
      createElement(
        Box,
        { sx: scrollBox, 'aria-label': 'Wide table' },
        createElement(Box, { sx: visuallyHidden }, 'No note'),
      ),
    );
    expect(scrollBoxes(html)).toEqual([
      { label: 'Wide table', positioned: true, holdsHiddenText: true },
    ]);
  });

  it('is how every box in the web app scrolls sideways, so each one is positioned', () => {
    // A box that scrolls on its own, written out rather than spread from `scrollBox`.
    const ownScroll = /\boverflow(?:X|-x)?\s*[:=]\s*['"{]*\s*['"]?(?:auto|scroll)\b/;
    const own = sources(SRC)
      .filter((file) => !file.endsWith(path.join('common', 'scroll-box.ts')))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, i) =>
            ownScroll.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : [],
          ),
      );
    expect(own).toEqual([]);
  });
});
