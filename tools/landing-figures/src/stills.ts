// Each figure's light still, the landing page's link preview: the tour's reduced-motion still,
// photographed in headless Chrome and stamped with what it was drawn from.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { STILL_SOURCE_KEY, stillDrift } from './check.ts';
import { STILL_SIZE, stillPath, type Figure } from './generate.ts';
import { cleanConsole, drive, linkPreviewPage } from './pages.ts';
import { isPng, pngSize, withPngText } from './png.ts';

/**
 * What a still is drawn from: its whole page (the drawing, the styles, the tour and the layout).
 * Chrome's pixels differ from machine to machine, so the still carries this instead of being
 * compared byte for byte.
 */
export const stillSource = (figure: Figure) =>
  createHash('sha256').update(linkPreviewPage(figure)).digest('hex');

/** Draws each figure's still under root, unless the one there was drawn from the same source. */
export function drawStills(figures: Figure[], root: string) {
  const dir = mkdtempSync(join(tmpdir(), 'landing-stills-'));
  try {
    for (const figure of figures) {
      const source = stillSource(figure);
      const still = join(root, stillPath(figure));
      if (!stillDrift(still, STILL_SIZE, source).length) continue;
      const page = join(dir, `${figure.id}-still.html`);
      const shot = join(dir, `${figure.id}-still.png`);
      writeFileSync(page, linkPreviewPage(figure));
      const out = drive(page, [
        ['wait', 1500],
        ['shot', shot, '.og', 1, [0, 0, STILL_SIZE.width, STILL_SIZE.height]],
      ]);
      const png = existsSync(shot) ? readFileSync(shot) : Buffer.alloc(0);
      const size = isPng(png) ? pngSize(png) : null;
      if (
        size?.width !== STILL_SIZE.width ||
        size.height !== STILL_SIZE.height ||
        !cleanConsole(out)
      )
        throw new Error(`Drawing the still for ${figure.id} failed.\n${out}`);
      mkdirSync(dirname(still), { recursive: true });
      writeFileSync(still, withPngText(png, STILL_SOURCE_KEY, source));
      console.log(`drew ${stillPath(figure)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
