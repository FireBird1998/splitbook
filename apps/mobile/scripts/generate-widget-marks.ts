import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { lightTokens, darkTokens } from '@splitbook/shared/design-tokens';

// Keep widget identity derived from the canonical filled paths, never from a font or drawing.
async function main() {
  for (const t of [lightTokens, darkTokens]) {
    const mode = t.mode;
    const mark = readFileSync(
      resolve('../../assets/brand/svg', mode === 'dark' ? 'mark-on-dark.svg' : 'mark-indigo.svg'),
      'utf8',
    );
    const inner = mark
      .replace(/^.*?<svg[^>]*>/s, '')
      .replace(/<\/svg>\s*$/, '')
      .replace(/<title>.*?<\/title>/s, '');
    writeFileSync(`assets/widgets/mark-${mode}.svg`, mark);
    await sharp(Buffer.from(mark))
      .resize(96, 96)
      .png()
      .toFile(`assets/widgets/setup-mark-${mode}.png`);
    const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="16" fill="${t.brand.bg}"/><g transform="translate(6 6) scale(.065)">${inner}</g><circle cx="38" cy="38" r="9" fill="${t.brand.main}" stroke="${t.surface}" stroke-width="2"/><path d="M34 38h8m-4-4v8" stroke="${t.brand.contrastText}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    writeFileSync(`assets/widgets/quick-tile-${mode}.svg`, tile);
    if (mode === 'light') {
      const headerMark = `<g transform="translate(14 14) scale(.03125)">${inner}</g>`;
      const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="440" viewBox="0 0 200 220"><rect width="200" height="220" rx="24" fill="${t.surface}"/>${headerMark}<g font-family="sans-serif" fill="${t.text}"><text x="36" y="27" font-size="11" font-weight="700">Balances</text><text x="133" y="26" font-size="9" fill="${t.textMuted}">Saved 9:41</text><text x="14" y="57" font-size="11" fill="${t.status.positive}" font-weight="700">You’re owed</text><text x="14" y="80" font-family="monospace" font-size="16" font-weight="700">₹2,400.00</text><text x="14" y="102" font-family="monospace" font-size="16" font-weight="700">€40.00</text><text x="14" y="135" font-size="11" fill="${t.status.negative}" font-weight="700">You owe</text><text x="14" y="158" font-family="monospace" font-size="16" font-weight="700">₹1,480.00</text><rect x="14" y="184" width="95" height="23" rx="12" fill="${t.brand.bg}"/><text x="23" y="199" font-size="10" font-weight="700" fill="${t.brand.main}">To review · 3</text></g></svg>`;
      await sharp(Buffer.from(preview)).png().toFile('assets/widgets/balances-preview.png');
      const quickPreview = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 90 90"><rect width="90" height="90" rx="24" fill="${t.surface}"/><g transform="translate(21 21)">${tile.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>$/, '')}</g></svg>`;
      await sharp(Buffer.from(quickPreview)).png().toFile('assets/widgets/quick-preview.png');
    }
  }
}
void main();
