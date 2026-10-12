# SplitBook website → ChatGPT connection

**Date:** 2026-10-11

**Scope:** Research and proposed onboarding, not an implementation or publication approval. Claude testing remains deferred. Provider documentation was checked on the date above; deployment status comes from this conversation and was not retested for this note.

## Recommendation

Keep the existing remote MCP backend. Add a user-facing **Connect ChatGPT** page in SplitBook, with guided custom-plugin setup for the private beta. For ordinary public users, package and submit that same MCP integration as a **SplitBook plugin**, then make the website button open its approved directory listing. This improves distribution without replacing the backend.

Call the task “Connect ChatGPT,” rather than “Install MCP.” Users connect an account and approve permissions; MCP is the underlying protocol. This wording and rollout sequence are product recommendations, not OpenAI requirements.

## Confirmed current provider behavior

- The current official setup guide uses **Plugins → plus → Add custom MCP server → Create as a plugin**, matching the interface observed earlier in this conversation. A public HTTPS endpoint can be connected directly; after installation, users can select the plugin with `@`. The older Apps SDK connect URL redirects to this Plugins guide. [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- Published plugins are discoverable through a direct directory listing link or name search. Public publication requires review and approval; private use can remain a custom MCP connection. The directory is shared by ChatGPT and Codex. A listing is not a guarantee of featured placement. [Remote MCP review and distribution](https://developers.openai.com/plugins/deploy/app-review)
- The desktop app documents `codex://plugins/install/<plugin-name>?marketplace=<marketplace-name>` for a plugin in a marketplace it already knows. It is not an arbitrary MCP-URL installer, and it falls back to Plugins if the entry is missing. A prefilled chat deep link does not auto-send its prompt. [Supported deep links](https://learn.chatgpt.com/docs/reference/commands)
- **No universal website URL that silently installs an arbitrary remote MCP server was found in the inspected official docs.** This is a research limitation, not proof that no other mechanism exists. Use the documented directory link after publication; do not invent a URL carrying the server address or claim that clicking alone finishes OAuth.
- Installation may prompt for service connection immediately or on first use. Availability depends on the plan, workspace settings, and individual plugin. Avoid promising that all accounts can add custom servers. [Plugin installation](https://learn.chatgpt.com/docs/plugins), [availability](https://learn.chatgpt.com/docs/use-chatgpt)

## Authentication and packaging

ChatGPT supports OAuth authorization-code + PKCE and recommends CIMD where supported. The authorization server advertises CIMD and `S256`; the server validates each token's audience, issuer, expiry and scopes. CIMD avoids giving each member a client ID or secret. It does not remove the member's sign-in and consent. [Authentication](https://developers.openai.com/plugins/build/auth)

A plugin package can declare its MCP endpoint and OAuth settings, including `client.mode: "cimd"`, `baseScopes` and `defaultScopes`. That lets the publisher configure settings once instead of asking every user to understand them. CIMD configuration must not contain client credentials. [Package configuration](https://developers.openai.com/plugins/build/plugins)

For public submission, prepare a verified publisher, plugin ZIP, domain verification, website/support/privacy/terms URLs, icons, reviewer access using sample data, five positive cases, three negative cases, and a demonstration recording. The portal supports CIMD. Reviewer access must work without an interactive MFA or emailed-code handoff, so SplitBook's Google-only staging access needs an explicit reviewer-access design. Never package credentials; provide them in the secure portal. [Submission](https://developers.openai.com/plugins/deploy/submission)

## Proposed website experience

1. Entry in **Settings → Connected assistants**, plus a public explanation page. Show ChatGPT first; keep Claude marked as pending testing.
2. Explain the currently enabled capability in ordinary language: read Groups, balances and spending. Explain that access covers current and future Groups. Keep Draft access separately described and disabled until its rollout is authorized.
3. For beta, show **Copy server URL**, **Open ChatGPT Plugins**, and a short illustrated guide. Clearly label staging. The staging endpoint recorded in this conversation is `https://mcp.staging.splitbook.in/api/mcp`; the future production endpoint must not be presented as live before deployment.
4. Keep advanced details collapsed: OAuth, CIMD, `ledger:read`, optional `offline_access`; no API key to paste. Prefer package defaults once distribution is available.
5. After publication, replace the primary guided-setup action with **Connect ChatGPT**, opening the real published listing URL. Preserve manual setup as a troubleshooting path.
6. Give a first prompt such as “Check my SplitBook connection,” then “What do I owe in my Groups?” Show permissions and disconnect controls inside SplitBook.
7. Distinguish authorization from a successful tool call. Show “Connection authorized” from the grant; claim “Connection tested” only after evidence of a successful MCP request. A browser return alone does not prove installation, tool selection or end-to-end success.

These steps are a proposed design. No page, OAuth behavior, permission or deployment was changed by this research.

## Other approaches

| Approach                               | Fit for SplitBook                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom remote MCP connection           | Practical beta path using the existing server; members still perform manual setup.                                                                                                                                                                                                                                                                                                    |
| Published ChatGPT plugin backed by MCP | Recommended public path: branded listing and simpler connection flow using the same domain services.                                                                                                                                                                                                                                                                                  |
| Custom GPT with Actions                | Not recommended for new work: current Enterprise migration guidance replaces custom actions with supported integrations or MCP. This is directional evidence, not a claim that every account has already lost GPTs. [Migration guidance](https://learn.chatgpt.com/docs/migrate-custom-gpts)                                                                                          |
| Chat embedded inside SplitBook         | A separate in-product assistant, for example using ChatKit and a server-side agent. It does not install SplitBook in the user's ChatGPT account. [ChatKit](https://developers.openai.com/api/docs/guides/chatkit)                                                                                                                                                                     |
| Sign in with ChatGPT                   | Can simplify eligible website/plugin identity flows, but is a separate integration requiring client registration. Signing in alone does not grant plugin data/action permissions. Do not replace existing OAuth with it solely for this onboarding task. [Website identity](https://developers.openai.com/siwc/website), [plugin permissions](https://learn.chatgpt.com/docs/plugins) |

Optional in-chat cards can be added later; OpenAI documents UI as optional and recommends keeping tools useful without it. They are not a prerequisite for a branded connection experience. [Optional MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui)

## Remaining verification before implementation

- Confirm the actual target account/workspace's ability to install the public plugin and add a custom server; older Help Center pages and current Plugins docs differ in terminology and availability detail.
- Choose whether the first website release is staging-only documentation or production onboarding.
- Obtain the real listing URL only after publication. Do not fabricate a SplitBook marketplace/plugin identifier.
- Design reviewer access and finalize the stable production MCP origin before public submission.
- Validate connection, refresh and revocation from the finished onboarding journey. Keep Draft activation and Claude acceptance as separate rollout decisions.
