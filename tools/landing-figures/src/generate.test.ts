import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFigures, tourScript } from './generate.ts';

const LICENSE = readFileSync(resolve(import.meta.dirname, '../vendor/anatomy/LICENSE'), 'utf8');

describe('the tour chunk for the web app', () => {
  it('carries the Anatomy kit’s whole MIT notice in code, where minifying can’t drop it', async () => {
    for (const figure of buildFigures()) {
      const source = tourScript(figure, 'esm');
      const { play } = (await import(
        `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
      )) as { play: { license?: string } };
      expect(play.license).toContain('Anatomy kit (https://github.com/wheresryan22/anatomy)');
      expect(play.license).toContain(LICENSE.trim());
    }
    // Bundling every figure's tour takes 6–7 s on CI runners, past Vitest's 5 s default.
  }, 30_000);
});
