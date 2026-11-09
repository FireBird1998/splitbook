import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STILL_SOURCE_KEY, stillDrift } from './check.ts';
import { STILL_DIR, type Figure } from './generate.ts';
import { THEMES, cleanConsole, drive, evalResult, type Theme } from './pages.ts';
import { withPngText } from './png.ts';
import { quietBaseCss, quietCss, quietPage, quietStillFile } from './quiet.ts';

export const quietStillSize = (figure: Figure) => ({
  width: Math.round(figure.width * 2.4),
  height: Math.round(figure.height * 2.4),
});
export const quietStillPath = (figure: Figure, theme: Theme) =>
  `${STILL_DIR}/${quietStillFile(figure, theme)}`;
export const quietStillSource = (figure: Figure, theme: Theme) =>
  createHash('sha256')
    .update(quietPage(figure, theme) + '\nquiet-still-scale:2.4')
    .digest('hex');

/** Rasterize the reduced-motion SVG itself, retaining its transparent background. */
function photograph(figure: Figure, theme: Theme): string {
  const size = quietStillSize(figure);
  return `(async () => {
    const svg = document.querySelector('[data-stage] svg').cloneNode(true);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '${size.width}'); svg.setAttribute('height', '${size.height}');
    svg.classList.add('iso'); svg.setAttribute('data-quiet', ''); svg.setAttribute('data-theme', '${theme}');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = ${JSON.stringify(quietBaseCss + figure.css + quietCss)};
    svg.prepend(style);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type: 'image/svg+xml'}));
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = ${size.width}; canvas.height = ${size.height};
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    } finally { URL.revokeObjectURL(url); }
  })()`;
}

/** Quiet stills are separate from the untouched 1200×630 light link previews and their stamps. */
export function drawQuietStills(figures: Figure[], root: string) {
  const dir = mkdtempSync(join(tmpdir(), 'quiet-stills-'));
  try {
    for (const figure of figures)
      for (const theme of THEMES) {
        const source = quietStillSource(figure, theme);
        const path = join(root, quietStillPath(figure, theme));
        const size = quietStillSize(figure);
        if (!stillDrift(path, size, source).length) continue;
        const page = join(dir, `${figure.id}-${theme}.html`);
        writeFileSync(page, quietPage(figure, theme));
        const out = drive(page, [
          ['eval', photograph(figure, theme)],
          ['wait', 100],
        ]);
        const data = evalResult<string>(out);
        if (!data || !cleanConsole(out))
          throw new Error(`Drawing quiet still ${figure.id} (${theme}) failed.\n${out}`);
        mkdirSync(join(root, STILL_DIR), { recursive: true });
        writeFileSync(path, withPngText(Buffer.from(data, 'base64'), STILL_SOURCE_KEY, source));
        if (stillDrift(path, size, source).length) throw new Error(`Invalid quiet still: ${path}`);
        console.log(`drew ${quietStillPath(figure, theme)}`);
      }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
