import localFont from 'next/font/local';

/*
 * The app's two fonts, served from the repository (#502), so a build never waits on Google's
 * font servers: Outfit for all UI text, IBM Plex Mono for money (docs/ui.md).
 *
 * The files are the subsets next/font/google used to download, one per Unicode range, and each
 * call below declares one subset under the family's real name with that subset's range, as
 * Google's stylesheet did, and in its order, Latin last: where two ranges share a character the
 * browser tries the face declared last, so a page fetches the same subset files as before
 * (Latin, and Latin Extended for a sign such as ₹). Only the Latin calls are preloaded. The
 * --font-* variables and the fallback faces are in fonts.css, which names the families
 * directly, the same under webpack and Turbopack.
 * The layout imports this module for its @font-face rules alone (next/font keeps a font
 * module's CSS whether or not an export is used), so the exports are unread on purpose; don't
 * remove them as dead code.
 * next/font takes literal options only, so the ranges are written out in each call.
 * Licences: fonts/<family>/OFL.txt.
 */

export const outfitLatinExtended = localFont({
  adjustFontFallback: false,
  src: './fonts/outfit/outfit-latin-ext.woff2',
  weight: '400 700',
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'Outfit' },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});

export const outfit = localFont({
  adjustFontFallback: false,
  src: './fonts/outfit/outfit-latin.woff2',
  weight: '400 700',
  declarations: [
    { prop: 'font-family', value: 'Outfit' },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

export const plexMonoCyrillicExtended = localFont({
  adjustFontFallback: false,
  src: [
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-400-cyrillic-ext.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-500-cyrillic-ext.woff2', weight: '500' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-600-cyrillic-ext.woff2', weight: '600' },
  ],
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    {
      prop: 'unicode-range',
      value: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
    },
  ],
});

export const plexMonoCyrillic = localFont({
  adjustFontFallback: false,
  src: [
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-400-cyrillic.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-500-cyrillic.woff2', weight: '500' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-600-cyrillic.woff2', weight: '600' },
  ],
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
});

export const plexMonoVietnamese = localFont({
  adjustFontFallback: false,
  src: [
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-400-vietnamese.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-500-vietnamese.woff2', weight: '500' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-600-vietnamese.woff2', weight: '600' },
  ],
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
});

export const plexMonoLatinExtended = localFont({
  adjustFontFallback: false,
  src: [
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-400-latin-ext.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-500-latin-ext.woff2', weight: '500' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-600-latin-ext.woff2', weight: '600' },
  ],
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});

export const plexMono = localFont({
  adjustFontFallback: false,
  src: [
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-400-latin.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-500-latin.woff2', weight: '500' },
    { path: './fonts/ibm-plex-mono/ibm-plex-mono-600-latin.woff2', weight: '600' },
  ],
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});
