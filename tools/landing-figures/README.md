# Landing figures

The drawings on the public landing page (#443) are isometric figures of small machines, made with the vendored Anatomy kit (`vendor/anatomy`, MIT, see its `PROVENANCE.md`). This package draws them at build time and writes them into the web app as generated modules (`apps/web/src/components/landing-figures/generated/`), so the page renders a real SVG with no runtime dependency on the kit.

Every number a figure shows comes from `src/story.ts`, which runs the story through `@splitbook/shared`: the exact-money split cuts each Expense and each member's chips, the balance calculation gives the counters, and the debt simplifier gives the payments. The figures can't drift from the product's money rules.

## Commands

From the repository root:

```sh
pnpm --filter @splitbook/landing-figures build     # regenerate the figures, and redraw any still that is out of date
pnpm --filter @splitbook/landing-figures check     # what CI runs
pnpm --filter @splitbook/landing-figures preview   # write interactive pages (light and dark) to a temp folder
pnpm --filter @splitbook/landing-figures test      # the story and check unit tests
```

`build` and `check` run headless Chrome. Set `CHROME_PATH` if Chrome isn't found. `build` stamps each still with what it was drawn from (a hash of its page, in a PNG text chunk) and redraws it only when that changes, so a rebuild doesn't churn the PNG.

`check` fails on any of these:

- **Stale output:** the generated modules differ from a fresh build. Run `build` and commit the result.
- **Stale output** also covers a file left in the generated folder that the build no longer writes. `build` removes it.
- **A story that doesn't balance:** a member's chips don't add up to their share, the counters don't sum to zero after every Expense, or the payments leave a balance unsettled.
- **A missing or stale still:** a figure's light still is missing, isn't a PNG, isn't 1200 × 630, or was drawn from another version of the figure (its stamp differs). `check` doesn't redraw it or compare pixels, because Chrome's pixels differ from machine to machine.
- **An edited vendored kit:** a file in `vendor/anatomy` differs from the bytes `MANIFEST.sha256` pins, or isn't listed there.
- **Audit problems:** the kit's audit finds clearance, depth-order, support or other faults in a figure's geometry.
- **Floating line ends, or a page error:** in light or dark, a line ends in mid-air, or the page logs an error. The vendored line-end check runs in headless Chrome with reduced motion, on the drawing at rest and on every pose of the live tour: its still, the finished line, the idle line, then each Expense before the last.

## Figures

| Figure                    | Module                           | Shows                                                                                                                                               |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fig 1, the splitting line | `src/figures/splitting-line.mjs` | Each Expense is a bar of chips, one per share. A saw cuts it, and pushers send each chip into its member's bin. The counters always add up to zero. |

Each figure module exports a function of the story that returns its SVG at rest, its own styles, the words around it (readout, legend, caption, the still's description), the data its live tour animates, and the audit recorder.

`<id>.tour.js` is the figure's live tour: `playTour(root, data)` runs it on a plate already in the page and returns a function that stops it. It works only inside `root`:

- clicking, or pressing →, Space or Enter, steps through the story;
- Home starts it over;
- it runs only while the figure is on screen.

It plays on by itself, so it shows the plate's Pause button (`[data-pause]`, WCAG 2.2.2): Pause holds the line where it is, and steps then show settled; Play goes on from there. Under reduced motion it opens on the figure's still, moves only when stepped and leaves the button hidden. It draws a frame only when something changes. The generator bundles it with the kit functions it uses (esbuild, pinned) and its data: as an ES module for the web app, and as a script for the preview, check and still pages. Every one of them runs the same code.

## Generated output

`build` owns `apps/web/src/components/landing-figures/generated/` and deletes any file there it doesn't write. Hand-written web code for the figures, such as the live tour's client component, goes beside it in `landing-figures/`, never inside `generated/`.

- `figure.ts`: the `LandingFigure` type and `figureCss`, the kit's styles. A wrapper with class `iso` gives the dark theme; add `data-theme="light"` for light.
- `<id>.ts`: one figure's `svg`, `css`, `label` (for `role="img"`), size, plate words and still. It imports `server-only`, so it can never reach a client bundle (Fig 1's is about 360 KB).
- `<id>-tour.js`: the figure's live tour with its data, about 20 KB. The web app loads it as its own chunk, near the screen. Next's minifier drops every comment, so the chunk carries the kit's MIT notice as `play.license`, and the Google suite checks the shipped script holds it.
- `tours.ts`: the loaders for those chunks, the only figure code in the client bundle.
- `index.ts`: re-exports for the server.

The drawing's markup is the same in both themes. Only the stylesheet's tokens change.

Each figure's light still, the page's link preview image, is `apps/web/public/landing-figures/<id>-light.png`: the tour's reduced-motion still at 1200 × 630.

In the web app, `LandingFigure` (a server component) renders the plate, and `FigureTour` (a client component) puts it in the page's theme and starts the tour once the figure comes near the screen.
