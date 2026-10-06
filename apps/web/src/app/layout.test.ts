import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/*
 * Browser tabs, bookmarks and home screens show the brand kit's icons (docs/design/brand),
 * and a page that sets its own title reads "<page> · Splitbook".
 */

// next/font only runs inside Next's compiler.
vi.mock('next/font/google', () => {
  const font = () => ({ variable: '--font-test', className: 'font-test', style: {} });
  return { Outfit: font, IBM_Plex_Mono: font };
});

const { metadata } = await import('./layout');

const APP = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(APP, '../../public');

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
