# Page: Landing page

**Route**: `/`
**Auth**: Public. A signed-in member is sent to `/dashboard`; in demo mode the page is the persona picker.
**Spec**: #443 (design: the canvas page "Landing page", on the Splitbook design system)

---

## Purpose

The page a visitor who isn't signed in gets. It explains Splitbook in one look, "every shared cost, worked out to the paisa", and sends each visitor to the right next step. It never describes a capability this deployment doesn't have live.

---

## What's live

One server-side description, `whatsLive()` in `src/lib/landing/whats-live.ts`, decides what the page may say. `src/app/page.tsx` computes it from the deployment's settings and passes it to `LandingPage`. No section or sentence decides on its own that something is live. Everything is off unless its setting turns it on:

| Capability                   | Live when                                                                                                              | What it shows                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistants available         | `MCP_ENABLED=true`, with an app address the assistant connection accepts                                               | The hero's "Use Claude or ChatGPT? Connect Splitbook" link to `#assistants` (the assistants section arrives with #450), and "Assistant guide" in the footer, linking to `/connect/chatgpt`        |
| Assistants can prepare items | Assistants available, and `PERSISTENT_DRAFTS_ENABLED=true` exactly, as the assistant connection reads it               | Nothing in the frame; the assistants section (#450) reads it                                                                                                                                      |
| Google Play listing          | `NEXT_PUBLIC_PLAY_STORE_URL` is an `https://play.google.com/store/apps/details?id=…` address                           | "Get the app" in the top bar, Google's "Get it on Google Play" badge in the hero and the closing call to action, "Android and web" in the hero's label, and Google's trademark line in the footer |
| Pricing visible              | `LANDING_PRICING_VISIBLE=true` (off until billing exists)                                                              | Nothing in the frame; the pricing section and its top bar link arrive with #447                                                                                                                   |
| Privacy, Terms, Support      | `PRIVACY_URL`, `TERMS_URL`, `SUPPORT_URL`: a page here (`/privacy`) or an HTTPS address; Support may also be `mailto:` | The footer's links, each only when set                                                                                                                                                            |

A setting that isn't valid counts as off. An assistant connection the server refuses to start isn't live, and an address that isn't a Play listing shows no store link.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ [Splitbook logo]     (section links)     Get the app   [Sign in] │  top bar
├──────────────────────────────────────────────────────────────────┤
│ (Shared expenses · Android and web)                              │
│ Every shared cost,          Trips, flats, couples and teams. …   │  hero
│ worked out to the paisa.    [Sign in with Google] [Google Play]  │
│                             Use Claude or ChatGPT? Connect …  →  │
├──────────────────────────────────────────────────────────────────┤
│ Fig 1 · The splitting line   (the live tour, Pause)              │  hero figure
├──────────────────────────────────────────────────────────────────┤
│ Groups · How an Expense splits                                   │  sections
│ Settle up: Fig 3 · The netting station, and the three payments   │
│ Android and web · Trust · Pricing                                │
├──────────────────────────────────────────────────────────────────┤
│        Start your first Group tonight. Settle it by the weekend. │  closing
│               [Sign in with Google] [Google Play]                │
├──────────────────────────────────────────────────────────────────┤
│ [mark] Splitbook · shared expenses, settled fairly.              │  footer
│        Privacy  Terms  Support  Assistant guide   © 2026 Splitbook │
│ Google Play and the Google Play logo are trademarks of Google LLC.│
└──────────────────────────────────────────────────────────────────┘
```

Parts in brackets show only when "what's live" allows them.

- **Top bar:** the logo links to `/` ("Splitbook home"). The section links are the sections the page shows; later tickets add them with their sections, and they're hidden below 900 px. "Get the app" links to the Play listing and is hidden below 900 px. "Sign in" links to `/login`, which explains invite-only access when sign-in is refused.
- **Hero:** the headline is the page's only `h1`. "Sign in with Google" is the primary action and starts Google sign-in, landing on `/dashboard`.
- **Figures:** Fig 1 (the splitting line) under the hero and Fig 3 (the netting station) in Settle up are server-rendered SVG with `role="img"` and their full descriptions, in the page's theme. Each plate's live tour loads near the screen: click, → or Space steps, Home starts over, Pause holds it, and under reduced motion it shows its documented still. `tools/landing-figures` draws them from the story model.
- **Settle up:** "Five debts between four people. Three payments.": Fig 3, then the three payments it works out, read from the figure's own data.
- **Closing call to action:** the same two actions under "Start your first Group tonight. Settle it by the weekend."
- **Footer:** the decorative mark beside the name, the configured links, the guide for connecting ChatGPT while assistants are available, and the year.

---

## Rules

- **Words:** the copy uses the Glossary's terms (Group, Theme, Expense, Month, Balances, Settle up, Activity, To review, Connected assistant) and none of its avoid-words.
- **Look:** the app theme's tokens in light and dark. Indigo is for the primary action, and the assistants link uses the info colour. The brand's logo and mark components follow the theme. The headline, the closing call to action and the promise use the theme's `display`, `displaySmall` and `lead` typography variants, and the top bar is `TOPBAR_HEIGHT` tall.
- **Rendering:** `LandingPage` is a server component, so the page reads without JavaScript and later sections and figures can render on the server too. Only `SignInWithGoogleButton` runs in the browser.
- **Google Play badge:** Google's official artwork from https://play.google.com/intl/en_us/badges/, unmodified, at `public/badges/google-play-badge-en.png`. It's shown at 78 px tall, where its visible badge is 52 px, the height of the buttons beside it. When it shows, the footer carries Google's trademark line.
- **Phone width:** one column, the top bar keeps the logo and Sign in, and nothing scrolls sideways at 390 px.
- **Link previews:** the page's title is "Splitbook · Every shared cost, worked out to the paisa", with the hero's promise as its description. Fig 1's still becomes the preview image with #448.

---

## Tests

- `src/lib/landing/whats-live.test.ts`: each setting, its default and the values that count as off.
- `src/components/landing/LandingPage.test.ts`: the page rendered for a signed-out visitor in both themes, with everything off, with a Play listing, with assistants available and with legal links. Also the top bar's section links and the route (Home for members, the persona picker in demo mode, and link-preview metadata).
- `src/components/layout/brand-surfaces.test.ts`: the logo and mark on the page.
- `playwright-google/google-auth.spec.ts`: the headline and Sign in with Google, no optional links on a server with nothing live, no serious or critical axe findings, and no sideways scroll on a 390 px phone in dark.
