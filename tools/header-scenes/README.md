# Header scene generator

Typed voxel models for Eco city and Mountain village, based on the owner's
`vx-engine`, `vx-kit`, `vx-eco` and `vx-alp` prototype and the `VoxelEcoCity` and
`VoxelAFrameVillage` design boards. Beach and Sakura belong to #1203.

Run from the repository root with Node 22:

```sh
pnpm --filter @splitbook/header-scenes build
pnpm --filter @splitbook/header-scenes check
pnpm --filter @splitbook/header-scenes test
pnpm --filter @splitbook/header-scenes render /absolute/path/to/review-images
```

`build` owns `packages/shared/src/header-scenes/` and removes obsolete output.
Never edit that output by hand. `check` builds again in memory and fails on any
missing, changed or obsolete file. `test:unit` runs the unit tests and that same
check, so the workspace tests and `pnpm swarm gate` cannot accept stale output.
CI also runs `check` beside the landing figures check in
`.github/workflows/landing-figures.yml`, with filters for the models and output.

`render` uses the repo's Playwright Chromium and writes four PNGs and standalone
HTML previews of the **generated output**, at day and night, at 1100 × 240 CSS
pixels and 2× scale. Install its browser with
`pnpm --filter @splitbook/header-scenes exec playwright install chromium` if
needed. It freezes a repeatable animation frame, retaining negative start delays.
The helper uses Effect v4 to scope the browser, bound its work and report a typed
render failure. The pure build/check generator uses ordinary synchronous file
reads and writes: it has no retries, network calls or resources to scope, so it
does not need Effect. No Effect enters shared code or either app (ADR 0006).

## Model and visibility

`engine.ts` projects integer cubes onto an isometric triangle lattice. Each
surface cell keeps only its nearest cube. Static geometry and moving foliage
are partitioned from **one** visibility solution, rather than rendering a second
static model behind foliage. Complete visible faces become quadrilaterals;
partially visible faces keep only their visible triangle. Subpaths of the same
colour share one path. Faces have no expanded strokes; the web uses crisp edge
rendering to avoid antialias seams without overlapping neighbouring faces.
Night light and water glints are deliberate effects over those visible faces.

The small-model tests prove complete occlusion by a moving cube and disjoint
static/moving coverage for partial occlusion. Tests assert coverage and semantic
layers, never generated path strings. Seeded noise keeps each build deterministic.

## Portable output

Import a scene only when it is needed:

```ts
const { default: scene } = await import('@splitbook/shared/header-scenes/eco-city');
const { headerSceneCss } = await import('@splitbook/shared/header-scenes/styles');
```

Each scene is a typed, JSON-compatible object (`HeaderSceneArt` in
`@splitbook/shared/header-scene-art`), with its name, one-sentence description,
viewBox, five vector layers (`far`, `clouds`, `main`, `front`, `glow`) and its
scene-specific web CSS. `styles.ts` holds common lighting and animation CSS.
All art data is framework-free; importing the types loads no artwork.

A vector is `{ tag, props, children?, classes?, motion?, delaySeconds? }`.
Props use SVG/react-native-svg names such as `fillOpacity` and `stopColor`.
Only groups, paths, polygons, circles, ellipses, rectangles and gradient definitions
are emitted. The web can serialize these as inline SVG (`vectors.ts` has the
serializer); Android can map tags to `react-native-svg` primitives without parsing
XML or loading a WebView. `classes` retain animation variants; `motion` names
sway, water, people, turbines, smoke, snow, clouds and floating groups independently.
The glow layer retains windows, lanterns and halos independently, so each renderer
can apply the chosen time of day and its own motion/reduced-motion preferences.
Native animation and lighting adapters belong to the renderer ticket, not this tool.

Render layers in the recorded order, with the time-of-day tint immediately before
the glow layer. Retain nested transforms. Prefix gradient ids and their `url(#…)`
references per rendered instance if several copies of the same scene share a DOM.
The 1100 × 240 viewBox is the board's wide frame; the Android renderer can crop
it to `70 0 460 240`, as the owner's Android prototype does. Cards, settings,
Group facts, motion preferences and tilt are owned by their renderer tickets.
