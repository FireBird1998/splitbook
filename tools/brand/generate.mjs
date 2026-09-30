import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import opentype from 'opentype.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = path.join(root, 'assets/brand');
const config = JSON.parse(await fs.readFile(path.join(dir, 'brand.json'), 'utf8'));
const font = opentype.loadSync(path.join(dir, 'source/Outfit-Bold.ttf'));
const master = await fs.readFile(path.join(dir, 'source/mark.svg'), 'utf8');
const paths = master.match(/<path\b[^>]*\/>/g)?.join('');
if (!paths || /<(image|script|text)\b/.test(master))
  throw new Error('Mark must be self-contained vector paths.');
const c = config.colors;
const args = process.argv.slice(2);
const checking = args.includes('--check');
const generated = new Map();
const svg = (w, h, body, title = 'Splitbook') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const mark = (color, size = 512, x = 0, y = 0) =>
  `<g fill="${color}" transform="translate(${x} ${y}) scale(${size / 512})">${paths}</g>`;
const rect = (x, y, w, h, fill, radius = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"/>`;
function letters(text, size = 100, tracking = 0) {
  const out = new opentype.Path();
  font.forEachGlyph(
    text,
    0,
    0,
    size,
    { kerning: true, letterSpacing: tracking },
    (glyph, x, y, s) => out.extend(glyph.getPath(x, y, s)),
  );
  return { d: out.toPathData(3), box: out.getBoundingBox() };
}
const word = letters(config.name, 100, config.wordmark.trackingEm);
const wordWidth = word.box.x2 - word.box.x1;
const wordHeight = word.box.y2 - word.box.y1;
function wordmark(color, x, y, height) {
  const scale = height / wordHeight;
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path fill="${color}" transform="translate(${-word.box.x1} ${-word.box.y1})" d="${word.d}"/></g>`;
}
function label(text, x, y, size = 22, color = c.ink) {
  return `<path fill="${color}" transform="translate(${x} ${y})" d="${letters(text, size).d}"/>`;
}
const lockupW = Math.ceil(140 + (wordWidth / wordHeight) * 76 + 16);
const variants = {
  light: [c.indigo, c.ink],
  dark: [c.indigoOnDark, c.white],
  ink: [c.ink, c.ink],
  white: [c.white, c.white],
};
const assets = new Map();
for (const [name, [symbolColor, textColor]] of Object.entries(variants)) {
  assets.set(
    `logo-${name}`,
    svg(lockupW, 128, mark(symbolColor, 112, 8, 8) + wordmark(textColor, 140, 26, 76)),
  );
  assets.set(
    `wordmark-${name}`,
    svg(
      Math.ceil(wordWidth * 2),
      Math.ceil(wordHeight * 2),
      wordmark(textColor, 0, 0, wordHeight * 2),
    ),
  );
  const stackedWordHeight = (640 * wordHeight) / wordWidth;
  assets.set(
    `stacked-${name}`,
    svg(
      800,
      640,
      mark(symbolColor, 400, 200, 20) + wordmark(textColor, 80, 464, stackedWordHeight),
    ),
  );
}
for (const [name, color] of Object.entries({
  indigo: c.indigo,
  'on-dark': c.indigoOnDark,
  ink: c.ink,
  white: c.white,
})) {
  assets.set(`mark-${name}`, svg(512, 512, mark(color)));
}
assets.set(
  'app-icon',
  svg(1024, 1024, rect(0, 0, 1024, 1024, c.ink) + mark(c.white, 680, 172, 172)),
);
assets.set(
  'app-icon-indigo',
  svg(1024, 1024, rect(0, 0, 1024, 1024, c.indigo) + mark(c.white, 680, 172, 172)),
);
assets.set(
  'maskable',
  svg(1024, 1024, rect(0, 0, 1024, 1024, c.ink) + mark(c.white, 740, 142, 142)),
);
// Android's essential content fits the central 66/108 diameter circle, not just a square.
assets.set('android-foreground', svg(1024, 1024, mark(c.white, 594, 215, 215)));
assets.set('android-monochrome', svg(1024, 1024, mark('#000000', 594, 215, 215)));
assets.set('favicon', svg(64, 64, rect(0, 0, 64, 64, c.ink, 14) + mark(c.white, 48, 8, 8)));

async function png(source, width, height, opaque = false) {
  const image = sharp(Buffer.from(source), { density: 288 }).resize(width, height);
  return (opaque ? image.removeAlpha() : image).png().toBuffer();
}
async function output(relative, bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  generated.set(relative, data);
  const filename = path.join(root, relative);
  if (checking) {
    const existing = await fs.readFile(filename).catch(() => null);
    if (!existing?.equals(data))
      throw new Error(
        `Stale or missing brand asset: ${relative}. Run npm run build in tools/brand.`,
      );
  } else {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, data);
  }
}

if (args.includes('--asset')) {
  const option = (flag) => args[args.indexOf(flag) + 1];
  const name = option('--asset');
  const source = assets.get(name);
  const width = Number(option('--width'));
  if (
    !source ||
    !args.includes('--width') ||
    !Number.isInteger(width) ||
    width < 16 ||
    width > 4096 ||
    !args.includes('--out')
  ) {
    throw new Error(
      'Use --asset <SVG filename without extension> --width <16..4096> --out <new .png or .svg file>',
    );
  }
  const filename = path.resolve(option('--out'));
  if (await fs.stat(filename).catch(() => null))
    throw new Error('Choose a new output filename; custom exports never overwrite.');
  const ext = path.extname(filename).toLowerCase();
  if (!['.png', '.svg'].includes(ext)) throw new Error('Custom exports support .svg and .png.');
  const [, w, h] = source.match(/viewBox="0 0 (\d+) (\d+)"/);
  const sized = source.replace(
    /width="\d+" height="\d+"/,
    `width="${width}" height="${+((width * Number(h)) / Number(w)).toFixed(3)}"`,
  );
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, ext === '.svg' ? sized : await png(source, width));
  console.log(filename);
  process.exit(0);
}

for (const [name, source] of assets) await output(`assets/brand/svg/${name}.svg`, source);
for (const variant of ['indigo', 'on-dark', 'ink', 'white']) {
  for (const size of config.sizes.mark)
    await output(
      `assets/brand/png/mark-${variant}-${size}.png`,
      await png(assets.get(`mark-${variant}`), size),
    );
}
for (const mode of ['light', 'dark'])
  for (const height of config.sizes.lockupHeights)
    for (const density of config.sizes.pixelDensities) {
      await output(
        `assets/brand/png/logo-${mode}-h${height}@${density}x.png`,
        await png(assets.get(`logo-${mode}`), undefined, height * density),
      );
    }
for (const size of config.sizes.app)
  await output(
    `assets/brand/png/app-icon-${size}.png`,
    await png(assets.get('app-icon'), size, undefined, true),
  );
for (const size of config.sizes.adaptive)
  for (const name of ['android-foreground', 'android-monochrome']) {
    await output(`assets/brand/png/${name}-${size}.png`, await png(assets.get(name), size));
  }
for (const size of [192, 512])
  await output(
    `assets/brand/png/maskable-${size}.png`,
    await png(assets.get('maskable'), size, undefined, true),
  );
for (const size of config.sizes.web) {
  await output(
    `assets/brand/png/web-icon-${size}.png`,
    await png(assets.get(size <= 48 ? 'favicon' : 'app-icon'), size, undefined, size >= 180),
  );
}
// ICO directory containing PNG entries: supported by modern browsers, no raster tracing.
const icoImages = await Promise.all([16, 32, 48].map((size) => png(assets.get('favicon'), size)));
const icoHeader = Buffer.alloc(6 + 16 * icoImages.length);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoImages.length, 4);
let offset = icoHeader.length;
for (const [i, image] of icoImages.entries()) {
  const at = 6 + 16 * i;
  const size = [16, 32, 48][i];
  icoHeader[at] = size;
  icoHeader[at + 1] = size;
  icoHeader.writeUInt16LE(1, at + 4);
  icoHeader.writeUInt16LE(32, at + 6);
  icoHeader.writeUInt32LE(image.length, at + 8);
  icoHeader.writeUInt32LE(offset, at + 12);
  offset += image.length;
}
await output('assets/brand/favicon.ico', Buffer.concat([icoHeader, ...icoImages]));

// Ready-to-import copies; this generator does not change application configuration.
for (const name of [
  'logo-light',
  'logo-dark',
  'mark-indigo',
  'mark-on-dark',
  'mark-white',
  'favicon',
]) {
  await output(`apps/web/public/brand/${name}.svg`, assets.get(name));
}
for (const size of [180, 192, 512])
  await output(
    `apps/web/public/brand/icon-${size}.png`,
    generated.get(`assets/brand/png/web-icon-${size}.png`),
  );
await output('apps/web/public/brand/favicon.ico', generated.get('assets/brand/favicon.ico'));
for (const name of ['app-icon', 'android-foreground', 'android-monochrome']) {
  await output(
    `apps/mobile/assets/brand/${name}.png`,
    generated.get(`assets/brand/png/${name}-1024.png`),
  );
}
for (const name of ['mark-indigo', 'mark-white'])
  await output(`apps/mobile/assets/brand/${name}.svg`, assets.get(name));

// An outlined, font-independent contact sheet for human review.
let board = rect(0, 0, 1600, 1500, c.paper);
board += label('SPLITBOOK / IDENTITY 01', 72, 75, 20, c.indigo);
board += label('Equal parts. One shared story.', 72, 143, 49);
board += label(
  'The approved S monogram, rebuilt as scalable vector artwork.',
  72,
  186,
  23,
  '#647084',
);
board += rect(64, 232, 1472, 444, c.white, 28);
board += `<g transform="translate(185 295) scale(${1230 / lockupW})">${assets
  .get('logo-light')
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')}</g>`;
board += label('PRIMARY / INDIGO + INK', 102, 639, 17, '#647084');
board += rect(64, 700, 712, 310, c.ink, 28);
board += `<g transform="translate(104 773) scale(${630 / lockupW})">${assets
  .get('logo-dark')
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')}</g>`;
board += label('DARK SURFACES', 102, 974, 17, '#B7C0D4');
board += rect(800, 700, 736, 310, '#E9ECF5', 28);
board += rect(848, 749, 168, 168, c.ink, 38) + mark(c.white, 112, 876, 777);
board += rect(1056, 749, 168, 168, c.indigo, 38) + mark(c.white, 112, 1084, 777);
board += `<circle cx="1358" cy="833" r="84" fill="${c.ink}"/>` + mark(c.white, 112, 1302, 777);
board += label('APP ICON / ALTERNATE / MASK PREVIEW', 842, 974, 17, '#647084');
board += label('ONE MARK. EVERY SCALE.', 80, 1074, 21);
for (const [i, size] of [16, 24, 32, 48, 64, 96].entries()) {
  const x = 84 + i * 114;
  board += mark(c.indigo, size, x, 1110 + (96 - size) / 2);
  board += label(`${size}px`, x, 1240, 16, '#647084');
}
const colors = [
  ['INDIGO', c.indigo],
  ['ON DARK', c.indigoOnDark],
  ['INK', c.ink],
  ['PAPER', c.paper],
];
for (const [i, [name, color]] of colors.entries()) {
  const x = 820 + i * 175;
  board +=
    rect(x, 1095, 150, 83, color, 16) +
    label(name, x, 1210, 15, '#647084') +
    label(color, x, 1240, 20);
}
board += label('Outfit Bold / outlined wordmark', 80, 1345, 25);
board += label(
  'SVG masters + web assets + native icon layers + repeatable exports',
  80,
  1389,
  21,
  '#647084',
);
board += label(
  'Clear space: 1/4 mark canvas. Minimum mark: 16px. Keep both halves together.',
  80,
  1442,
  19,
  '#647084',
);
await output(
  'docs/design/brand/brand-board.svg',
  svg(1600, 1500, board, 'Splitbook brand identity overview'),
);
await output('docs/design/brand/brand-board.png', await png(svg(1600, 1500, board), 1600));

// Verify the artifact properties that commonly break platform imports.
for (const [name, data] of generated)
  if (name.endsWith('.svg')) {
    if (/<(image|text|script)\b|href=|url\(/.test(data.toString()))
      throw new Error(`External or non-vector content: ${name}`);
  }
for (const name of ['android-foreground', 'android-monochrome']) {
  const data = generated.get(`assets/brand/png/${name}-1024.png`);
  const { data: raw, info } = await sharp(data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let nonempty = false;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (raw[(y * info.width + x) * 4 + 3] > 0) {
        nonempty = true;
        if (Math.hypot(x + 0.5 - 512, y + 0.5 - 512) > (1024 * 33) / 108)
          throw new Error(`${name} exceeds Android circular safe zone`);
      }
  if (!nonempty) throw new Error(`${name} is blank`);
}
const appBytes = generated.get('assets/brand/png/app-icon-1024.png');
if ((await sharp(appBytes).metadata()).hasAlpha)
  throw new Error('Native app icon must have no alpha channel.');
const opaqueStats = await sharp(appBytes).stats();
if (!opaqueStats.isOpaque) throw new Error('App icon must be fully opaque.');
const manifest = [];
for (const [name, bytes] of generated) {
  const meta = name.endsWith('.png') ? await sharp(bytes).metadata() : null;
  manifest.push({
    file: name,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...(meta ? { width: meta.width, height: meta.height, alpha: meta.hasAlpha } : {}),
  });
}
await output(
  'assets/brand/manifest.json',
  JSON.stringify({ version: config.version, files: manifest }, null, 2) + '\n',
);
console.log(
  `${checking ? 'Verified' : 'Generated'} ${generated.size} files. SVG paths, opaque app icon and Android circular safe zones verified.`,
);
