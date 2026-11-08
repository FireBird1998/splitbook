import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { lightTokens as t, darkTokens } from '@splitbook/shared/design-tokens';

async function generate() {
  const output = new URL('../assets/widgets/', import.meta.url);
  await mkdir(output, { recursive: true });
  const master = await readFile(
    new URL('../../../assets/brand/svg/mark-indigo.svg', import.meta.url),
    'utf8',
  );
  for (const tokens of [t, darkTokens]) {
    await writeFile(
      new URL(`mark-${tokens.mode}.svg`, output),
      master.replace('#6366F1', tokens.brand.main),
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="440" viewBox="0 0 400 440">
<rect width="400" height="440" rx="48" fill="${t.surface}"/>
<g transform="translate(28 28) scale(.07)">${master.match(/<g .*<\/g>/)?.[0].replace('#6366F1', t.brand.main)}</g>
<g font-family="sans-serif" fill="${t.text}">
<text x="78" y="56" font-size="24" font-weight="bold">Balances</text>
<text x="252" y="56" font-size="20" fill="${t.textMuted}">Saved 9:41</text>
<text x="28" y="112" font-size="22" fill="${t.status.positive}" font-weight="bold">You’re owed</text>
<text x="28" y="155" font-size="32" font-family="monospace">₹2,400.00</text>
<text x="28" y="194" font-size="32" font-family="monospace">€40.00</text>
<text x="28" y="251" font-size="22" fill="${t.status.negative}" font-weight="bold">You owe</text>
<text x="28" y="294" font-size="32" font-family="monospace">₹1,480.00</text>
<rect x="28" y="350" width="234" height="48" rx="24" fill="${t.brand.bg}"/>
<text x="46" y="382" font-size="22" fill="${t.brand.main}" font-weight="bold">To review · 3</text>
</g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(new URL('balances-preview.png', output).pathname);
}
void generate();
