# SplitBook Android — initial design brief

Status: proposed design scope; screens have not yet been generated or approved.

## Outcome

A clickable Android prototype covering the everyday journey from choosing a group to adding a shared expense and recording a settlement. Design for quick, one-handed use with clear money labels. The prototype is a design artifact; it does not move money or connect to production accounts.

## Visual direction

Carry over the current SplitBook design system: restrained financial layouts, indigo primary actions, sky information, coral for money you owe, and mint for money owed to you or settled. Use Outfit for UI and IBM Plex Mono for amounts. Design light and dark together using semantic tokens from `apps/web/src/lib/theme/tokens.ts`; `docs/ui.md` explains their roles. Historical private-beta mockups are references, not token authority.

Use Android-friendly bottom navigation, clear back behavior, comfortably sized touch targets, keyboard-aware expense entry, and bottom sheets for short selections. Keep amounts readable with enlarged text, explicit currency, and labels that do not rely on color alone.

## First prototype flow

1. **Entry:** Google sign-in and a separate local demo-persona experience. Demo personas are Alex, Sam, and Priya; the production experience must not expose demo authentication.
2. **Home / groups:** personal money summary, group list, and a prominent add-expense action. Present Trip, Household, Couple, Work, and General as group types.
3. **Group detail:** expenses, balances, and activity. A Trip receives the signature itinerary / boarding-pass strip. A Household receives a neutral ledger header, month selector, and monthly expense summary.
4. **Add expense:** amount and currency, description, group, payer, participants, and date. Start with equal split; disclose other split methods progressively. Show the resulting shares before saving. Include validation, saving, success, and recoverable failure states that retain entered values.
5. **Balances / settle up:** clearly identify who owes whom, the amount and currency, and the action to record a payment. Review before recording and show confirmation afterward. Recording a settlement must not imply that the app transferred funds.

Supporting screens: create group with theme selection, invite members, expense detail, and settings with light/dark preference. Include empty group and loading states.

## Product invariants

- Group category changes structure and terminology, not the palette. Trip imagery and route codes appear only on trips.
- Household months filter expense views. They do not reset balances or close ledgers. Label month totals separately from the running balance.
- Do not combine different currencies into an unexplained total.
- Clearly distinguish money you owe from money owed to you; avoid a net-only summary that hides obligations.
- Use fictional sample data. Design receipt capture only as a separately identified proposal if it is explored later.

## Deliverables and review

Produce a screen overview plus a navigable prototype in both themes. Review the complete flow: select Household → add expense → inspect split → save → inspect balances → record settlement. Also review a Trip to validate its distinct header, and a past household month to validate the balance labels.

Confirm visual direction and navigation before selecting the Android implementation stack. Kotlin/Compose versus React Native is still an open decision; these designs should not silently choose it.

## Source references

- `docs/ui.md`: visual system and token roles.
- `docs/design-system/README.md`: current implementation patterns and component lab.
- `docs/v4/README.md`: category-as-theme behavior.
- `docs/v4/monthly-views.md`: household month semantics.

## OpenDesign setup status

OpenDesign 0.24.1 is installed. The bundled Codex CLI 0.155.0-alpha.9 is exposed through `~/.local/bin/codex`; OpenDesign detected it and its local connection test returned “ok”. Local-agent onboarding completed.

The official `open-design@open-design` plugin 0.5.3 is installed. The `open-design` stdio MCP registration is enabled and points to the installed application. A new Codex task is needed to load these tools. Design generation has not yet been tested; no screens have been generated.

Official download: https://open-design.ai/download/

Official Codex integration: https://open-design.ai/codex-plugin/
