# Landing figures

The public landing page's quiet isometric machines use the vendored Anatomy kit (`vendor/anatomy`,
MIT; see `PROVENANCE.md`). The generator writes server-rendered SVGs, theme-specific transparent
stills and separate lazy client tours. Never edit `apps/web/src/components/landing-figures/generated/`:
`build` owns the folder and removes obsolete output.

## Commands

Run from the repository root:

```sh
pnpm --filter @splitbook/landing-figures build
pnpm --filter @splitbook/landing-figures check
pnpm --filter @splitbook/landing-figures test
pnpm --filter @splitbook/landing-figures preview
```

`build` and `check` run headless Chrome (`CHROME_PATH` can select its executable). Preview writes
six `<id>-quiet-<theme>.html` pages. PNGs carry a source hash and redraw only when it changes.

## Story and geometry

All numbers come from `src/story.ts` through `@splitbook/shared`: exact-money splits, Balances,
Suggested payments and prepared items. The splitting line cuts each Expense into its members'
chips; the To review rack lets only the member's lever save a prepared item; the netting station
replaces the pairwise debts with the fewest payments. Their original geometry is shared across
both quiet palettes and the link preview.

`check` verifies current output and PNG stamps, a balancing story, the unchanged vendored kit,
the geometry audit, and line ends through ordinary timed playback in light and dark. It reads
every drawn counter frame: readings must sum to zero and never overshoot their targets. It also
checks autoplay, pause/resume, ignored clicks and keys, offscreen cancellation and reduced-motion
inactivity. Unit tests enforce the approved 0.6 speed and the original raw/gzip chunk budgets.

## Generated page assets

- `quiet.ts` exports `splittingLineQuiet`, `toReviewRackQuiet`, `nettingStationQuiet`, `quietFigureCss`
  and `QuietFigure`. Each figure has SVG, its own CSS, dimensions and `stills.light` / `stills.dark`.
- `quiet-tours.ts` exports lazy `quietTours[id]()` loaders. Each `<id>-quiet-tour.js` contains just
  that scene, its data and the decorative runner. Its full MIT notice is retained as `play.license`.
- `QUIET_TOUR_SPEED` is exported through the quiet modules. Its one editable source is
  `src/quiet-tour.ts`: `0.6` times the original story clock.
- `story.ts` exports server-only heading, payments and prepared-item metadata used by the copy.
- `link-preview.ts` exports the unchanged link-preview image metadata.

The page renders `.iso[data-quiet]` and a `[data-stage]` SVG inside an `aria-hidden` wrapper, with
pointer events disabled. It adapts the generated theme selectors to the page's pre-paint root
choice. The approved desktop and phone placement and both standard/WebKit edge masks belong to
`apps/web/src/components/landing-figures/quiet-layout.ts`.

```ts
const { play } = await quietTours[figure.id]!();
const control = play(root);
control.setPaused(true); // the page's one Pause animation button controls every loaded tour
control.setPaused(false); // continues from the held frame; no persistence
control.stop(); // cancel frames and disconnect observers on unmount
```

The runner starts only while the stage intersects the viewport and ignores all stepping input.
Quiet CSS disables independent animations and transitions. Under Reduce motion the page shows
the correct theme's PNG, loads no tour and hides the pause control; the runner itself also respects
that preference. The page's pending lazy loads inherit its current pause choice.

The framed page modules, controls, live regions and stepping checks have been removed. The old
runner and link-preview page recipe remain private generator inputs solely to preserve the
1200 × 630 light link-preview PNG and its source stamp byte for byte. They are never page chunks.
