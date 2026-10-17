Splitbook is a shared-expense ledger for Groups of people: a Trip, a Household, a Couple, Work or anything else. The product is calm about money. It says exactly who owes what, in which currency, and never makes the reader do arithmetic. The look is a hybrid: Travel Ledger structure (one signature boarding-pass strip, ruled rows, money in a monospace) with Calm Finance restraint (one brand hue, quiet surfaces, colour reserved for meaning).

## Content fundamentals

- **Plain, exact words.** Say what happened and what to do next: "Priya paid ₹1,200 for Dinner", "You owe Sam ₹300", "Saved", "Couldn't save. Check your connection and try again." No exclamation marks, no jokes about money, no emoji.
- **Sentence case everywhere**, buttons included: "Add expense", "Record payment", "Finish later". Never Title Case or uppercase labels; `overline` is the only uppercase style, for Trip day eyebrows.
- **You and your.** The member is "you"; other members are named. Never "the user". A list of who paid shows the viewer as "You".
- **The name is Splitbook**: capital S, lower-case b, one word.
- **Use the glossary's words on screen.** Group, Expense, Balances, Settle up, Record payment, Activity, Tag, Category, Month, Trip day, To review, Finish later, Saved copy, Connected assistant. Avoid their listed alternatives in product copy: inbox or drafts (say To review), keep as draft (say Finish later), cache or offline data (say Saved copy), bot, agent or integration (say Connected assistant), cycle or billing month (say Month).
- **Money is never vague.** Show the currency with every amount (₹, $, €), keep each Group's currency separate, and never add two currencies into one number. Say "settled" only when the balance is truly zero; missing data is never shown as settled.
- **Assistants are named.** An item an assistant prepared says so: "prepared by Claude". An assistant can prepare items for To review; only the member saves them.

## Visual foundations

**Colour.** Colours are named by role, defined for `light` and `dark` together; never hard-code a hex.
- `brand` (indigo) is identity and the primary action. One filled `brand` button per view; text on it is `on-brand`.
- Money status: `positive` (mint) means settled or owed to you; `negative` (coral) means you owe or something needs attention; `info` (sky) is informational; `warning` is caution. Their main values are decorative in light: use them for bars, dots, icons and amounts at 24px or larger. Small status text uses `status-positive`, `status-negative`, `status-warning` or `status-info`, which hold 4.5:1 on `bg`, `surface` and their `*-bg` tints in both themes. A status colour always comes with a word or a sign (−₹300, "You owe"), never colour alone.
- Grounds: `bg` for the page, `surface` for cards, `surface-muted` for recessed areas, `bg-elevated` for the sidebar and top bar. Separate with `border` hairlines first and `shadow-sm` second.
- Text: `text` for primary copy, `text-secondary` for metadata. `text-muted` is for hints on `surface`; on `bg` or `surface-muted` in light it is below 4.5:1, so use it there only at 19px bold or larger.
- Charts use one hue: `chart-series` for the figure in focus, `chart-series-soft` for the rest, `chart-grid` for rules. The diverging Balances chart is the one exception (`diverging-positive` and `diverging-negative`), because the sign is the figure.
- The `logo-*` colours belong to the logo artwork only.

**The signature: the trip strip.** A Trip's header is a boarding pass: a 135° gradient through `strip-start`, `strip-mid` and `strip-end`, `strip-text` on top, a stub on the right lifted by `strip-stub`, and a seam of punched holes in `strip-perforation` (the page colour showing through). Corners `radius-lg`. It appears once per Trip screen and nowhere else; other Group Themes get a quiet header.

**Type.** Outfit for every word, IBM Plex Mono for every amount.
- Titles `h5` (Group and page titles) and `h6` (sections and cards), both 700 with tight tracking.
- Rows: `subtitle1` for the title, `body2` for the line under it.
- Body copy `body1`; fine print `caption`; buttons `button` (600, sentence case).
- Amounts use `money` at the size of their line, tabular figures, right-aligned in columns. A headline balance uses `money-large` in `status-positive` or `status-negative`.
- Keep semantic headings (h1, h2…) separate from the visual style.

**Space and layout.** The 8px scale (`space-1` = 8px). Fields stack at `space-2`, cards pad `space-2` on phones and `space-3` on desktop, sections sit `space-4` apart. On the web, the shell is a full-height sidebar (`sidebar-width`), a top bar (`topbar-height`) and content up to `content-max-width`. Phones keep a 16px gutter and never scroll sideways. Breakpoints are MUI's: 600, 900, 1200 and 1536px.

**Shape.** `radius-sm` for buttons, chips and inputs; `radius-md` for cards; `radius-lg` for dialogs, sheets and the trip strip. No pills except chips.

**Elevation.** `shadow-sm` on cards at rest, `shadow-md` on menus and raised sheets. Nothing glows. No gradients except the trip strip.

**States.** Hover on rows and navigation is `surface-hover`. Keyboard focus is a solid 2px `focus` outline 2px outside the control plus a 4px `focus-ring` halo, at least 3:1 on every surface in both themes. Selected navigation uses `brand-bg` with `brand` text. Disabled controls drop to `text-muted` without changing their shape.

**Motion.** Short and functional: panels rise 8px and fade in; a balance that changes fades from 40% to full. Everything goes still under reduced motion.

**Imagery.** No stock photos, no people, no 3D blobs. When the product needs an illustration (the landing page), it is a precise drawing of a real object in the same tones, with colour only where colour means money: coral for owed, mint for settled, indigo for the one part to watch.

## Iconography

Material icons from `@mui/icons-material`, at 20 or 24px, drawn in `text-secondary` or the colour of the status they carry. The app mixes the filled and outlined sets (about 85 filled and 36 outlined imports); prefer outlined for navigation and empty states, filled for small status glyphs. Icons sit beside a word except in a labelled icon button. No emoji, in the product or in marketing.

## The logo

The Equal share mark: two matching rounded forms, rotated 180° to make an S with a continuous gap. Use the files in the Logos group; never redraw it, set it in a font, outline it or recolour it beyond the supplied variants.
- `logo-light.svg` on white or paper, `logo-dark.svg` on ink or dark surfaces, at 32px high in headers (24px compact, 40–48px large). The web's `BrandLogo` component picks the right one from the theme.
- `mark-indigo.svg` or `mark-on-dark.svg` alone at 24–48px where space is tight; `stacked-*` for large centred branding at 200px wide or more.
- Clear space: half the lockup's height around a horizontal logo; a quarter of the mark's size around a mark.
- Minimum: mark 16px (24px preferred), horizontal logo 24px high, wordmark 16px high.
- The app icon is a white mark on `logo-ink`; `app-icon-indigo.svg` is a marketing alternate.
- Alt text: "Splitbook home" when the logo is the home link, "Splitbook" otherwise, empty when the name is written beside it.
