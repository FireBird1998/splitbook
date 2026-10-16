# Landing figures

The drawings on the public landing page (#443) are isometric figures of small machines, made with the vendored Anatomy kit (`vendor/anatomy`, MIT, see its `PROVENANCE.md`). This package draws them at build time and writes them into the web app as generated modules (`apps/web/src/components/landing-figures/generated/`), so the page renders a real SVG with no runtime dependency on the kit.

Every number a figure shows comes from `src/story.ts`, which runs the story through `@splitbook/shared`: the exact-money split cuts each Expense and each member's chips, the balance calculation gives the counters, and the debt simplifier gives the payments. The figures can't drift from the product's money rules.

## Commands

From the repository root:

```sh
pnpm --filter @splitbook/landing-figures build     # regenerate the figures into the web app
pnpm --filter @splitbook/landing-figures check     # what CI runs
pnpm --filter @splitbook/landing-figures preview   # write interactive pages (light and dark) to a temp folder
pnpm --filter @splitbook/landing-figures test      # the story and check unit tests
```

`check` fails on any of these:

- **Stale output:** the generated modules differ from a fresh build. Run `build` and commit the result.
- **Stale output** also covers a file left in the generated folder that the build no longer writes. `build` removes it.
- **A story that doesn't balance:** a member's chips don't add up to their share, the counters don't sum to zero after every Expense, or the payments leave a balance unsettled.
- **An edited vendored kit:** a file in `vendor/anatomy` differs from the bytes `MANIFEST.sha256` pins, or isn't listed there.
- **Audit problems:** the kit's audit finds clearance, depth-order, support or other faults in a figure's geometry.
- **Floating line ends:** in light or dark, a line ends in mid-air. The vendored line-end check runs in headless Chrome with reduced motion, on the drawing at rest and on every pose of the live tour: the last step settled, the idle line, then each step. Set `CHROME_PATH` if Chrome isn't found.

## Figures

| Figure                    | Module                           | Shows                                                                                                                                               |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fig 1, the splitting line | `src/figures/splitting-line.mjs` | Each Expense is a bar of chips, one per share. A saw cuts it, and pushers send each chip into its member's bin. The counters always add up to zero. |

Each figure module exports a function of the story that returns its SVG at rest, its own styles, the data its live tour animates, and the audit recorder. `<id>.tour.js` is the reference live tour the `preview` command runs. The web app's client component plays the same data.

## Generated output

`build` owns `apps/web/src/components/landing-figures/generated/` and deletes any file there it doesn't write. Hand-written web code for the figures, such as the live tour's client component, goes beside it in `landing-figures/`, never inside `generated/`.

- `figure.ts`: the `LandingFigure` type and `figureCss`, the kit's styles. A wrapper with class `iso` gives the dark theme; add `data-theme="light"` for light.
- `<id>.ts`: one figure's `svg`, `css`, `label` (for `role="img"`), size and `tour` data.
- `index.ts`: re-exports.

The drawing's markup is the same in both themes. Only the stylesheet's tokens change.
