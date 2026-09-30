# Splitbook brand assets

The approved **Equal share** identity: two matching forms make one S. Start with [the brand standard](../../docs/design/brand/README.md) and [visual overview](../../docs/design/brand/brand-board.png).

- `source/mark.svg` — authoritative editable mark; 512 × 512 coordinates.
- `source/Outfit-Bold.ttf` and `source/OFL.txt` — licensed wordmark source.
- `brand.json` — identity palette, wordmark settings, spacing and standard export sizes.
- `svg/` — generated marks, outlined wordmarks, horizontal and stacked logos, app layers.
- `png/` — generated raster sizes; filenames state dimensions or rendered height/density.
- `manifest.json` — generated dimensions, hashes and inventory.
- `favicon.ico` — 16/32/48 px icon bundle.

Build with `npm ci --prefix tools/brand --ignore-scripts` then `npm run build --prefix tools/brand`. Check committed/generated outputs with `npm run check --prefix tools/brand`. See the brand standard for custom exports and integration.
