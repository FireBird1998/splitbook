# Expense module depth: published tickets

Status: approved and published on September 28, 2026. Implementation belongs to the agent the user will start.

Parent specification: https://github.com/FireBird1998/splitbook/issues/65

## Tickets

1. **[Preserve manual Expense allocations through one money-edit module](https://github.com/FireBird1998/splitbook/issues/66)**
   - **Blocked by:** None — can start immediately.
   - **What it delivers:** Members can edit a manual Expense and trust that its preview, saved allocation and resulting Balance agree. Metadata edits retain historical allocations, while deliberate financial changes use the existing exact-money rules. Introduce the pure money-edit module through this complete existing flow, rather than adding an unused abstraction.

2. **[Keep recurring Expense previews and edits financially consistent](https://github.com/FireBird1998/splitbook/issues/67)**
   - **Blocked by:** #66.
   - **What it delivers:** Household admins see recurring allocation previews that match what a template edit will save. Metadata edits retain the stored allocation; deliberate financial edits affect eligible future generation without rewriting already generated Expenses.

3. **[Preserve new Expense drafts and retry lost submissions](https://github.com/FireBird1998/splitbook/issues/68)**
   - **Blocked by:** #66.
   - **What it delivers:** A member entering a new Expense keeps their input through Group refresh, validation and connection failures. If the server commits but the response is lost, an explicit unchanged retry completes the same submission once. Concentrate this lifecycle in the Expense draft module and integrate the existing web form.

4. **[Preserve Expense edit drafts through conflicts and explicit reload](https://github.com/FireBird1998/splitbook/issues/69)**
   - **Blocked by:** #68.
   - **What it delivers:** A member can edit an Expense without losing entered fields to background refresh or overwriting newer work. Stale saves keep the draft and conflict visible until an explicit successful reload adopts the latest saved Expense and revision.

5. **[Verify the combined Expense editing and recovery flows](https://github.com/FireBird1998/splitbook/issues/70)**
   - **Blocked by:** #67, #69.
   - **What it delivers:** Demonstrate that the completed deepening preserves the full local product experience: manual and recurring money edits agree with previews and saved records, drafts recover predictably, and financial retries cannot duplicate the ledger. Provide a concrete verification handoff for the completed work.

## Test surface

Use the existing isolated app and real local MongoDB, with authenticated HTTP and browser journeys as the primary acceptance surface. Focused tests use the same money-edit and Expense draft interfaces as production callers. Preserve distinct real-database, authorization, arithmetic and browser checks; finish with the existing full regression, accessibility, visual and build checks.

## Dependencies and handoff

- Start with #66. Once it is done, #67 and #68 are independently eligible.
- #69 follows #68. #70 follows #67 and #69.
- Each ticket is labelled ready-for-agent and has a native parent relationship; blocking edges are native GitHub issue dependencies.
- Each adoption slice remains green. Ticket #68 may temporarily retain the current edit path; #69 removes that bridge.
- Preserve the parent specification’s body and open state. Do not implement the exploratory candidates under these tickets.
- Google setup stays deferred; preserve local configuration and persistent user data.
- The user will start the implementation agent; no implementation agent is started by this planning task.

## Suggested prompt for the implementation agent

Implement https://github.com/FireBird1998/splitbook/issues/65 by completing tickets #66–#70 in dependency order. Start with #66; after it, #67 and #68 are eligible, followed by #69 and then #70. Read each issue and the repository instructions. Use the existing isolated local app and real MongoDB acceptance tests, preserve the user’s local data and drafts, keep each slice green, and finish with the full regression/build checks. Keep Google setup and the separate Group response / ledger retry explorations out of scope. Do not close or rewrite the parent specification.
