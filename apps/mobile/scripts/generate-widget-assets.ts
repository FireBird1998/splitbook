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
    await sharp(Buffer.from(master.replace('#6366F1', tokens.brand.main)))
      .resize(96, 96)
      .png()
      .toFile(new URL(`setup-mark-${tokens.mode}.png`, output).pathname);
    const mark = master.match(/<g .*<\/g>/)?.[0].replace('#6366F1', tokens.brand.main);
    const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="16" fill="${tokens.brand.bg}"/><g transform="translate(6 6) scale(.065)">${mark}</g><circle cx="38" cy="38" r="9" fill="${tokens.brand.main}" stroke="${tokens.surface}" stroke-width="2"/><path d="M34 38h8m-4-4v8" stroke="${t.brand.contrastText}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    await writeFile(new URL(`quick-tile-${tokens.mode}.svg`, output), tile);
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
  const group = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400"><rect width="720" height="400" rx="48" fill="${t.surface}"/><g font-family="sans-serif" fill="${t.text}"><text x="28" y="52" font-size="28" font-weight="bold">⌂  Maple House</text><text x="510" y="52" font-size="20" fill="${t.textMuted}">Saved 9:41</text><text x="28" y="92" font-size="24" fill="${t.status.negative}">You owe ₹1,480.00</text><rect x="28" y="120" width="664" height="142" rx="24" fill="${t.surfaceMuted}"/><text x="50" y="173" font-size="24">You pay Priya</text><text x="490" y="173" font-size="24">₹1,060.00</text><text x="50" y="230" font-size="24">You pay Sam</text><text x="510" y="230" font-size="24">₹420.00</text><rect x="430" y="300" width="262" height="64" rx="24" fill="${t.brand.bg}"/><text x="466" y="342" font-size="24" fill="${t.brand.main}">＋ Add expense</text></g></svg>`;
  await sharp(Buffer.from(group)).png().toFile(new URL('group-preview.png', output).pathname);
  const quick = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" rx="42" fill="${t.surface}"/><g transform="translate(45 35) scale(.22)">${master.match(/<g .*<\/g>/)?.[0].replace('#6366F1', t.brand.main)}</g><circle cx="146" cy="146" r="24" fill="${t.brand.main}"/><path d="M134 146h24m-12-12v24" stroke="${t.brand.contrastText}" stroke-width="4"/></svg>`;
  await sharp(Buffer.from(quick)).png().toFile(new URL('quick-preview.png', output).pathname);
}
void generate();
