import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFigures, generatedFiles, OUT_DIR, tourScript, type Figure } from './generate.ts';

const LICENSE = readFileSync(resolve(import.meta.dirname, '../vendor/anatomy/LICENSE'), 'utf8');

describe('the tour chunk for the web app', () => {
  // Drawing every figure takes seconds on CI runners: draw them once for the file.
  let figures: Figure[] = [];
  beforeAll(() => {
    figures = buildFigures();
  }, 60_000);

  it('generates a quiet figure and tour for every story', () => {
    const files = generatedFiles(figures);
    for (const figure of figures) {
      expect(files.has(`${OUT_DIR}/${figure.id}-quiet.ts`)).toBe(true);
      expect(files.has(`${OUT_DIR}/${figure.id}-quiet-tour.js`)).toBe(true);
    }
  });

  it('carries the Anatomy kit’s whole MIT notice in code, where minifying can’t drop it', async () => {
    for (const figure of figures) {
      const source = tourScript(figure, 'esm');
      const { play } = (await import(
        `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
      )) as { play: { license?: string } };
      expect(play.license).toContain('Anatomy kit (https://github.com/wheresryan22/anatomy)');
      expect(play.license).toContain(LICENSE.trim());
    }
  }, 30_000);
});
