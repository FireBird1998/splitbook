import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/*
 * Browser tabs, bookmarks and home screens show the brand kit's icons (docs/design/brand),
 * and a page that sets its own title reads "<page> · Splitbook".
 */

// next/font only runs inside Next's compiler; the stand-in records what the layout asks for.
const fontCalls = vi.hoisted(() => [] as LocalFontOptions[]);
vi.mock('next/font/local', () => ({
  default: (options: LocalFontOptions) => {
    fontCalls.push(options);
    return { variable: 'font-test', className: 'font-test', style: { fontFamily: 'test' } };
  },
}));

interface LocalFontOptions {
  src: string | { path: string }[];
  variable?: string;
  declarations?: { prop: string; value: string }[];
}

const { metadata } = await import('./layout');

const APP = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(APP, '../../public');

describe('the app fonts (#502)', () => {
  const family = (call: LocalFontOptions) =>
    call.declarations?.find((declaration) => declaration.prop === 'font-family')?.value;
  const files = (call: LocalFontOptions) =>
    typeof call.src === 'string' ? [call.src] : call.src.map((entry) => entry.path);

  it('are Outfit and IBM Plex Mono, under the variables the design system reads', () => {
    expect([...new Set(fontCalls.map(family))]).toEqual(['Outfit', 'IBM Plex Mono']);
    expect(fontCalls.map((call) => call.variable).filter(Boolean)).toEqual([
      '--font-outfit',
      '--font-plex-mono',
    ]);
  });

  it('load from files in the repository, so a build never fetches them from Google', () => {
    for (const file of fontCalls.flatMap(files)) {
      expect(existsSync(path.join(APP, file)), file).toBe(true);
    }
  });

  it('keep each family’s SIL Open Font License beside its files', () => {
    for (const [folder, copyright] of [
      ['outfit', 'Copyright 2021 The Outfit Project Authors'],
      ['ibm-plex-mono', 'Copyright © 2017 IBM Corp.'],
    ]) {
      const licence = readFileSync(path.join(APP, 'fonts', folder, 'OFL.txt'), 'utf8');
      expect(licence.startsWith(copyright), folder).toBe(true);
      expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});

describe('the root metadata', () => {
  it('points browsers at the brand favicon, and Apple devices at the 180 px brand icon', () => {
    expect(metadata.icons).toEqual({
      icon: [
        { url: '/brand/favicon.ico', sizes: '16x16 32x32 48x48' },
        { url: '/brand/favicon.svg', type: 'image/svg+xml' },
      ],
      apple: [{ url: '/brand/icon-180.png', sizes: '180x180', type: 'image/png' }],
    });
  });

  it('names icons the brand kit ships', () => {
    const icons = metadata.icons as Record<string, { url: string }[]>;
    for (const { url } of [...icons.icon, ...icons.apple]) {
      expect(existsSync(path.join(PUBLIC, url)), url).toBe(true);
    }
  });

  it('has no app icon file that would override them', () => {
    // Next's file conventions (favicon.ico, icon.*, apple-icon.*) win over metadata icons.
    expect(readdirSync(APP).filter((file) => /^(favicon|icon|apple-icon)\./.test(file))).toEqual(
      [],
    );
  });

  it('keeps the home title, and titles other pages "<page> · Splitbook"', () => {
    expect(metadata.title).toEqual({
      default: 'Splitbook - Shared Expenses, Settled Fairly',
      template: '%s · Splitbook',
    });
  });
});
