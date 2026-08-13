# Secure Next.js (Vercel) ↔ MongoDB Atlas Connectivity

**Date:** 2026-08-13
**Scope:** This repo — Next.js 16 (App Router) on Vercel Hobby serverless + MongoDB Atlas M0 (free) cluster, private beta (~5 users). Browser calls only Next.js API routes; Mongoose (`src/lib/db.ts`) and the Auth.js MongoDB adapter (`src/lib/mongodb-client.ts`) run server-side; `MONGODB_URI` has no `NEXT_PUBLIC_` prefix.
**Sources:** Primary docs only — mongodb.com/docs, vercel.com/docs, nextjs.org/docs (plus react.dev for taint APIs). Every claim is linked inline.

---

## TL;DR

- **Your architecture is the officially recommended one.** Browser → Next.js API routes → MongoDB server-side is exactly the pattern Next.js and MongoDB prescribe. The browser-direct-to-MongoDB pattern is not just discouraged — the product that enabled it (Atlas Data API) reached **end-of-life on 2025-09-30** and no longer exists.
- **`0.0.0.0/0` on Atlas is a calculated, vendor-sanctioned trade-off for Vercel Hobby — not a best practice.** MongoDB's security docs [warn against it explicitly](https://www.mongodb.com/docs/atlas/security/ip-access-list/), but MongoDB's own [Vercel native integration adds `0.0.0.0/0` automatically](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel) because Vercel uses dynamic egress IPs. On Hobby + M0 there is no affordable alternative: Static IPs need Vercel Pro ($100/mo add-on), and private endpoints / workload identity federation need Atlas M10+.
- **What actually protects you at `0.0.0.0/0`:** mandatory TLS, SCRAM-SHA-256 auth, a least-privilege database user, and your application-layer auth checks. The IP allowlist was never a real authentication boundary — credentials are.
- **Biggest cheap wins for this repo:** make `MONGODB_URI` a _sensitive_ Vercel env var, scope the Atlas database user to `readWrite` on the `splitwise` DB only, add `import 'server-only'` to the two DB modules, and use the 1 free WAF rate-limit rule Hobby includes.
- **Passwordless (Vercel OIDC → Atlas Workload Identity Federation) exists in 2026 but is out of reach:** Atlas WIF requires dedicated M10+ clusters, and there is no documented Vercel↔Atlas OIDC federation path.

---

## 1. Why browser-direct-to-MongoDB is unsafe, and what guarantees server-only secrets in Next.js

### The browser-direct problem

A database connection string embeds credentials. Anything shipped to the browser is public by definition, so a browser-direct database client publishes your credentials to every visitor. This is why MongoDB's browser-accessible offering (the Data API) used API keys over HTTPS instead of the wire protocol — and even that product has been shut down (see §6). The current MongoDB/Vercel integration guidance is unambiguous: the app connects to Atlas from server-side code using the `MONGODB_URI` environment variable ([MongoDB Atlas for Vercel](https://vercel.com/marketplace/mongodbatlas), [Integrate with Vercel — MongoDB Docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel)).

### What officially guarantees server-only secrets in Next.js

- **Default server-only env vars.** "By default, environment variables are only available on the server. To expose an environment variable to the browser, it must be prefixed with `NEXT_PUBLIC_`." Non-prefixed variables "are only available in the Node.js environment, meaning they aren't accessible to the browser." ([Next.js — Environment Variables](https://nextjs.org/docs/app/guides/environment-variables))
- **`NEXT_PUBLIC_` inlining is build-time string replacement.** Next.js inlines the value "at build time, into the js bundle that is delivered to the client, replacing all references to `process.env.[variable]` with a hard-coded value." After the build, the app no longer responds to changes to these variables. ([Next.js — Bundling Environment Variables for the Browser](https://nextjs.org/docs/app/guides/environment-variables))
- **`server-only` package as a build-time tripwire.** Next.js recommends marking modules that must never reach the client with `import 'server-only'`, which "ensures that proprietary code or internal business logic stays on the server by causing a build error if the module is imported in the client environment." ([Next.js — Data Security: Preventing client-side execution of server-only code](https://nextjs.org/docs/app/guides/data-security), [server-only on npm](https://www.npmjs.com/package/server-only))
- **React taint APIs (experimental, defense-in-depth).** `experimental_taintObjectReference` and `experimental_taintUniqueValue` throw if a tainted object/value crosses the Server→Client boundary; enabled via `experimental.taint` in `next.config.js`. React and Next.js both stress this is _an additional layer_, not a substitute for not passing secrets: tainting doesn't cover derived values or object copies. ([React — taintUniqueValue](https://react.dev/reference/react/experimental_taintUniqueValue), [Next.js — taint config](https://nextjs.org/docs/app/api-reference/config/next-config-js/taint), [Next.js — Data Security: Tainting](https://nextjs.org/docs/app/guides/data-security))

### Verified against this repo

- `MONGODB_URI` is read only in server modules: `src/lib/db.ts` (Mongoose, global-cache pattern) and `src/lib/mongodb-client.ts` (MongoClient for the Auth.js adapter). No `NEXT_PUBLIC_` variant exists.
- `src/lib/mongodb-client.ts` correctly avoids `directConnection: true` for `mongodb+srv://` (Atlas) URIs.
- **Gap:** neither DB module imports `server-only`. Adding it would turn a future accidental client import into a build error instead of a silent leak vector.

---

## 2. Atlas network-access options for Vercel serverless, ranked

Context: [Vercel deployments use dynamic IP addresses](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel) (MongoDB's docs state this plainly, citing Vercel). Vercel's own KB confirms fixed egress IPs require either the Static IPs add-on (Pro) or Secure Compute (Enterprise) ([Can I get a fixed IP address?](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address)).

### Option A — `0.0.0.0/0` IP allowlist (what you have; the de-facto Hobby path)

- MongoDB's warning, verbatim: "Adding the `/0` CIDR, such as `0.0.0.0/0`, **allows access from anywhere. This configuration can expose your deployment to unauthorized access, data exfiltration, and other malicious activity.** Restrict access to trusted IP addresses or CIDR ranges whenever possible, and use strong credentials for all database users when allowing access from the public internet." ([Atlas — IP Access List](https://www.mongodb.com/docs/atlas/security/ip-access-list/))
- Atlas **emails an alert to all project users** whenever any `/0` CIDR is added to the access list. ([same page](https://www.mongodb.com/docs/atlas/security/ip-access-list/))
- MongoDB now offers **Resource Policies** that can _block_ wildcard IPs org-wide — marketed as fixing a "dangerous database security mistake." ([MongoDB blog — Wildcard IPs](https://www.mongodb.com/company/blog/innovation/stop-a-dangerous-database-security-mistake-wildcard-ips))
- **But:** MongoDB's official Vercel native integration _itself_ requires and auto-adds `0.0.0.0/0`: "To connect to an Atlas cluster, the IP access list of your Atlas cluster must allow all IP addresses (0.0.0.0/0). If Atlas doesn't find an entry for 0.0.0.0/0… Atlas adds it on your behalf, as part of the integration workflow." ([Integrate with Vercel — MongoDB Docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel))
- New in 2025–2026: the **Atlas Network Protection Layer (ANPL)** — a defense-in-depth layer that "inspects unauthenticated traffic to your cluster and blocks malicious requests before they reach the database" — auto-enabled on _select dedicated Atlas 8.3 clusters_ that have `0.0.0.0/0` in the access list. Not self-serve, not on free tier, and MongoDB still recommends replacing `0.0.0.0/0` with specific CIDRs or private networking. ([Atlas Network Protection Layer](https://www.mongodb.com/docs/atlas/security/network-protection-layer/), referenced from [IP Access List docs](https://www.mongodb.com/docs/atlas/security/ip-access-list/))

**Verdict:** acceptable for a private beta on Hobby/M0 _only when paired with_ strong credentials + least privilege (§3) and app-layer controls (§5). It is the posture MongoDB's own Vercel integration ships.

### Option B — Vercel Static IPs add-on (the realistic upgrade)

- "With Static IPs (shared pool), you can access backend services that require IP allowlisting through static egress IPs… for Pro and Enterprise teams." **$100/month per project**, plus Private Data Transfer at regional rates. Shared VPC, subnet-level isolation; up to 3 regions. ([Vercel — Static IPs](https://vercel.com/docs/networking/static-ips), [Vercel — Networking](https://vercel.com/docs/networking), [Vercel — Pricing](https://vercel.com/docs/pricing))
- **Not available on Hobby.** ([Vercel KB](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address), [Getting Started with Static IPs](https://vercel.com/docs/networking/static-ips/getting-started))
- Vercel itself notes: "A fixed IP alone does not guarantee security, and it is still recommended to use authentication methods such as user and password pairs… to fully secure your resources." ([Vercel KB](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address))
- Caveats: IPs are shared with a small group of other Vercel customers; project-level (can't scope per environment); incompatible with some function betas. ([Static IPs docs](https://vercel.com/docs/networking/static-ips))

**Verdict:** the first upgrade to make when leaving Hobby — Pro ($20/mo) + Static IPs ($100/mo) lets you delete `0.0.0.0/0` and allowlist 2–3 fixed IPs.

### Option C — Atlas Private Endpoint / VPC peering (enterprise-grade, M10+ only)

- "This feature is not available for **Free clusters and Flex clusters**." Private endpoints require dedicated clusters (**M10+**); AWS PrivateLink / Azure Private Link / GCP Private Service Connect. ([Atlas — Private Endpoint](https://www.mongodb.com/docs/atlas/security-private-endpoint/), [Atlas — Free & Shared Cluster Limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/))
- On the Vercel side, private connectivity to backends is **Secure Compute** — "Static in dedicated VPC… VPC Peering, full isolation," Enterprise only, custom pricing. ([Vercel — Static IPs comparison table](https://vercel.com/docs/networking/static-ips), [Vercel KB](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address))
- MongoDB's architecture guidance recommends M10+ dedicated clusters precisely because they get their own VPC/VNet and support private endpoints/peering. ([Atlas — Network Security](https://www.mongodb.com/docs/atlas/architecture/current/network-security/))

**Verdict:** correct end-state for production at scale, but requires _both_ Atlas M10+ _and_ Vercel Enterprise (Secure Compute) for a fully private path. Excluded on M0 by definition.

### Option D — Vercel Marketplace native integration (2025–2026, changes provisioning not networking)

- Since **2025-09-10**, MongoDB Atlas is a Vercel **native integration**: provision Free/Flex/Dedicated clusters from the Vercel dashboard, billing via Vercel, auto-configures `MONGODB_URI`. ([Vercel changelog](https://vercel.com/changelog/mongodb-atlas-joins-the-vercel-marketplace), [MongoDB blog](https://www.mongodb.com/company/blog/product-release-announcements/atlas-now-available-in-vercel-marketplace), [Marketplace listing](https://vercel.com/marketplace/mongodbatlas), [MongoDB partner docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel))
- **Important for security posture:** the integration does _not_ solve the network problem — it auto-adds `0.0.0.0/0`, and it creates a `Vercel-Admin-<name>` database user with the broad built-in role **`readWriteAnyDatabase`**. "Atlas ensures secure connections via SCRAM authentication with IP allowlists." ([MongoDB partner docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel))
- Free clusters are available on the integration's free plan; Flex/Dedicated require the paid installation plan. ([MongoDB partner docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel))

**Verdict:** convenient provisioning, but tighten the auto-created user's role afterwards. Not needed for this already-provisioned project.

### Ranking for this app (Hobby + M0)

1. **Now:** `0.0.0.0/0` + strong SCRAM + least-privilege user (only viable option on this stack).
2. **First upgrade:** Vercel Pro + Static IPs → allowlist fixed IPs, delete `0.0.0.0/0`.
3. **Later/scale:** Atlas M10+ (+ Vercel Secure Compute if full private networking is required) → private endpoints, auditing, WIF.

---

## 3. What actually protects the database when `0.0.0.0/0` is set

The allowlist gates _connection attempts_; everything below still stands between an attacker and your data:

- **TLS is mandatory and always-on.** "Atlas enforces mandatory TLS encryption of connections to your databases. TLS 1.2 is the default protocol" (1.3 recommended; minimum version configurable). ([Atlas — Network Security](https://www.mongodb.com/docs/atlas/architecture/current/network-security/), [Atlas — Shared Responsibility Model](https://www.mongodb.com/resources/products/fundamentals/shared-responsibility)) So `0.0.0.0/0` does not enable sniffing of wire traffic.
- **SCRAM authentication.** SCRAM is MongoDB's default; Atlas supports SCRAM-SHA-256 by default. Notably, MongoDB's current guidance says SCRAM is recommended "only for use in development and test environments" — for production they steer toward X.509, AWS IAM, or Workload Identity Federation. ([Atlas — Add Database Users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users), [Atlas — Authentication architecture](https://www.mongodb.com/docs/atlas/architecture/current/auth/authentication/)) On M0, SCRAM is the only option — which is fine _if_ the password is long, unique, and generated (it only needs to resist online guessing against a rate-limited, monitored endpoint).
- **Least-privilege database users (RBAC).** Atlas supports built-in roles and custom roles scoped to specific databases/collections; the shared-responsibility model puts "design least-privilege access policies" squarely on the customer. ([Atlas — Add Database Users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users), [MongoDB built-in roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/), [Shared Responsibility](https://www.mongodb.com/resources/products/fundamentals/shared-responsibility)) Practically: the app user should be `readWrite` on the `splitwise` database only — **not** `atlasAdmin`, and not the `readWriteAnyDatabase` that the Vercel integration auto-creates.
- **Brute-force / auditing features.** Granular **database auditing** (incl. `authenticate` failure events) is **M10+ only**. ([Atlas — Database Auditing](https://www.mongodb.com/docs/atlas/database-auditing/), [Atlas — Auditing guidance](https://www.mongodb.com/docs/atlas/architecture/current/auditing/), [MongoDB manual — Auditing](https://www.mongodb.com/docs/manual/core/auditing/)) On M0 you get: the automatic alert email when `/0` entries are added ([IP Access List docs](https://www.mongodb.com/docs/atlas/security/ip-access-list/)) and, for eligible dedicated 8.3 clusters, ANPL pre-auth malicious-traffic blocking ([ANPL](https://www.mongodb.com/docs/atlas/security/network-protection-layer/)). There is no free-tier account-lockout audit trail — another reason the password must be unguessable rather than merely "okay."

**Is `0.0.0.0/0` + strong credentials "acceptable" per MongoDB?** Their security docs say avoid it where possible and pair public-internet exposure with strong credentials ([IP Access List](https://www.mongodb.com/docs/atlas/security/ip-access-list/)); their Vercel integration ships exactly that combination ([partner docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel)). Read together: **tolerated as the standard pattern for dynamic-egress platforms, contingent on credential strength and least privilege — and explicitly "strongly discouraged" as a permanent production posture.**

---

## 4. Credential hygiene on Vercel

- **Encrypted at rest; scoped per environment.** "These values are encrypted at rest… It is safe to use both non-sensitive and sensitive data, such as tokens." Variables scope to Production / Preview / Development / custom environments; preview vars can be pinned to a specific git branch. ([Vercel — Environment Variables](https://vercel.com/docs/environment-variables), [Manage across environments](https://vercel.com/docs/environment-variables/manage-across-environments))
- **Sensitive variables.** Values become **non-readable once created** (dashboard and CLI); available for Production and Preview only (Development vars stay "encrypted," never sensitive). `vercel env add KEY production --sensitive`; team owners can enforce a sensitive-by-default policy. ([Vercel — Sensitive Environment Variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [Manage across environments](https://vercel.com/docs/environment-variables/manage-across-environments))
- **Rotation.** Vercel maintains a documented rotation procedure ("follow the steps for rotating environment variables to update it without downtime"). ([Vercel — Environment Variables](https://vercel.com/docs/environment-variables), [Rotating secrets](https://vercel.com/docs/environment-variables/rotating-secrets)) Note: runtime env var changes apply to the _next_ deployment/request for functions; build-inlined values need a rebuild.
- **Vercel OIDC federation exists (2026).** Vercel acts as an OIDC IdP issuing short-lived tokens (`VERCEL_OIDC_TOKEN` in builds, `x-vercel-oidc-token` header in functions; ~1–2h TTL), explicitly to "avoid storing long-lived credentials as Vercel environment variables." Official exchange guides exist for **AWS, GCP, Azure, and your own API** — via `@vercel/oidc`. ([Vercel — OIDC Federation](https://vercel.com/docs/oidc), [OIDC reference](https://examples.vercel.com/docs/oidc/reference))
- **…but Atlas Workload Identity Federation is M10+ only.** "Atlas supports Workload Identity Federation on only dedicated clusters (M10 and above) running MongoDB version 7.0.11 and above." Drivers authenticate with `MONGODB-OIDC`; Atlas "stores the user identifiers and privileges, but not the secrets." ([Atlas — Workload Identity Federation](https://www.mongodb.com/docs/atlas/workload-oidc/), [MongoDB manual — WIF](https://www.mongodb.com/docs/manual/core/oidc/workload/)) There is **no documented Vercel↔Atlas OIDC federation path** in 2026 — Vercel's OIDC docs cover AWS/GCP/Azure/custom APIs, and Atlas's WIF docs cover Azure Entra ID and Google Cloud service accounts. A custom-callback bridge (`MONGODB-OIDC` + `getVercelOidcToken()`) is theoretically plausible but undocumented by both vendors, and moot on M0 anyway.

**Verdict for this app:** passwordless DB auth is not available on your tiers. Best practice here: `MONGODB_URI` as a **sensitive** Production (+Preview if needed) env var, generated 32+ char password, documented rotation runbook, and never commit `.env.local` (already gitignored by Next.js convention).

---

## 5. Application-layer protections that matter more than network rules

For this app, the blast radius of a leaked DB credential is bounded by the DB user's role (§3); the blast radius of _application_ bugs is bounded by these layers — which is why they outrank network rules day-to-day:

- **Per-route auth checks.** Every API route must authenticate the session and authorize group membership before touching the DB. Next.js recommends centralizing this in a Data Access Layer / server-only modules rather than scattering checks. ([Next.js — Data Security](https://nextjs.org/docs/app/guides/data-security)) This repo already follows auth check → Zod validation → service → `{ data } | { error }` (see `docs/api.md`, `CONTEXT.md`).
- **Input validation.** Zod at the route boundary (already the repo pattern) is the primary defense against malformed/malicious payloads reaching Mongoose.
- **Rate limiting on Vercel (2026 state).** Vercel WAF rate limiting is available **on all plans including Hobby**: Hobby gets **1 rate-limit rule per project** (and 3 total custom firewall rules), Fixed Window algorithm, 10s–10min windows, keyed by IP or JA4 digest; mitigated traffic doesn't count toward CDN usage. Rules apply instantly without redeploy; natural-language rule creation supported (e.g. "Rate limit POST /auth/login to 10 per minute per IP, deny for 15 minutes"). For per-user/per-ID limiting in code, Vercel ships `@vercel/firewall` (Rate Limiting SDK). ([Vercel — WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Custom Rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules), [WAF overview](https://vercel.com/docs/vercel-firewall/vercel-waf), [Usage & Pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing), [KB — Add rate limiting](https://vercel.com/kb/guide/add-rate-limiting-vercel))
- **Atlas-side backstops.** Free-tier clusters have hard resource ceilings (connections, storage) that cap abuse impact ([Free & Shared Limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)); the automatic `/0` alert email and (on eligible dedicated clusters) ANPL provide platform-level tripwires. ([IP Access List](https://www.mongodb.com/docs/atlas/security/ip-access-list/), [ANPL](https://www.mongodb.com/docs/atlas/security/network-protection-layer/))

---

## 6. Status check: Atlas Data API — dead

**Deprecated and end-of-lifed.** The Atlas Data API (the browser-accessible HTTPS API) reached **EOL on 2025-09-30**, as part of the full Atlas App Services shutdown (Device Sync, SDKs, Data API, GraphQL, Static Hosting, HTTPS Endpoints). MongoDB's own Admin API reference carries the EOL banner: "Atlas Device Sync, SDKs, Data API, GraphQL, Static Hosting, and HTTPS Endpoints have reached EOL on September 30, 2025." ([MongoDB — Atlas App Services Admin API v3, EOL notice](https://www.mongodb.com/docs/api/doc/atlas-app-services-admin-api-v3), [MongoDB — App Services Deprecation page](https://www.mongodb.com/docs/atlas/app-services/deprecation/))

Implication: there is no first-party browser-accessible MongoDB HTTP API in 2026. The server-side API-route pattern this app uses is not merely safer — it is the only supported shape.

---

## 7. Recommended setup for THIS app (M0 + Vercel Hobby, private beta, ~5 users)

### Keep (already correct)

- Browser → Next.js API routes only; Mongoose + Auth.js adapter server-side; `MONGODB_URI` unprefixed. Matches Next.js and MongoDB guidance exactly.
- `mongodb+srv://` URI without `directConnection` (Atlas requirement; already handled in `src/lib/mongodb-client.ts`).
- Auth check → Zod → service pattern in every route; soft-delete expenses; per-group authorization.

### Do now (free, < 1 hour total)

1. **Tighten the Atlas database user** to `readWrite` on the `splitwise` database only (drop `atlasAdmin`/`readWriteAnyDatabase` if present). ([Atlas — Add Database Users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users), [built-in roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/))
2. **Regenerate the DB password** as a generated 32+ character secret; store `MONGODB_URI` as a **sensitive** Vercel env var scoped to Production (and Preview only if preview deploys need Atlas). ([Sensitive env vars](https://vercel.com/docs/environment-variables/sensitive-environment-variables))
3. **Accept `0.0.0.0/0` knowingly** as the only workable Hobby option — the same posture MongoDB's own Vercel integration ships ([partner docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel)) — and record it as a deliberate decision. Note the automatic Atlas alert email on `/0` changes acts as a tamper tripwire. ([IP Access List](https://www.mongodb.com/docs/atlas/security/ip-access-list/))
4. **Add `import 'server-only'`** to `src/lib/db.ts` and `src/lib/mongodb-client.ts` so any future client-side import fails the build. ([Next.js — Data Security](https://nextjs.org/docs/app/guides/data-security))
5. **Use your 1 free Hobby WAF rate-limit rule** on the most abuse-prone path (e.g. `POST /api/auth/*` or `/api/groups/*`), keyed by IP, fixed window. ([Vercel — WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting))
6. **Write a 5-line rotation runbook** (Atlas: edit user password → Vercel: update sensitive env var → redeploy) following Vercel's rotation guide. ([Rotating secrets](https://vercel.com/docs/environment-variables/rotating-secrets))

### Explicitly skip (not applicable / not available on your tiers)

- Atlas Data API or any browser-direct DB access — product is EOL. ([EOL notice](https://www.mongodb.com/docs/api/doc/atlas-app-services-admin-api-v3))
- Vercel OIDC → Atlas WIF passwordless — Atlas WIF is M10+ only and no Vercel↔Atlas federation is documented. ([Atlas WIF](https://www.mongodb.com/docs/atlas/workload-oidc/), [Vercel OIDC](https://vercel.com/docs/oidc))
- Private endpoints / VPC peering — excluded on M0. ([Private Endpoint docs](https://www.mongodb.com/docs/atlas/security-private-endpoint/))
- The Vercel Marketplace native integration for this existing setup — it would auto-add `0.0.0.0/0` and a broad `readWriteAnyDatabase` user anyway. ([partner docs](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel))

### When to upgrade — trigger list

| Trigger                                                                            | Upgrade                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beta ends / real users' financial data at stake, or any compliance question arises | **Vercel Pro + Static IPs ($100/mo)** → replace `0.0.0.0/0` with 2–3 fixed egress IPs ([Static IPs](https://vercel.com/docs/networking/static-ips))                                                                             |
| Need audit trail of DB logins (who connected, failed auth attempts)                | **Atlas M10+** → database auditing ([Auditing](https://www.mongodb.com/docs/atlas/database-auditing/))                                                                                                                          |
| Want to eliminate the stored DB password entirely                                  | **Atlas M10+** → Workload Identity Federation (still requires an IdP path; no Vercel-native one documented) ([WIF](https://www.mongodb.com/docs/atlas/workload-oidc/))                                                          |
| Data > 512 MB, need backups/metrics/performance guarantees                         | **Atlas M10+** (or Flex for cheap burst) ([Free limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/))                                                                                            |
| Full private networking (no public DB endpoint at all)                             | **Atlas M10+ private endpoints + Vercel Enterprise Secure Compute** ([Private Endpoint](https://www.mongodb.com/docs/atlas/security-private-endpoint/), [Static IPs comparison](https://vercel.com/docs/networking/static-ips)) |
| Abuse/DoS beyond 1 WAF rule                                                        | **Vercel Pro** (40 rules) + `@vercel/firewall` in-code limiting ([Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting))                                                                             |

**Bottom line:** on Hobby + M0, `0.0.0.0/0` is the vendor-sanctioned default for dynamic-egress platforms, not a misconfiguration — provided credentials are strong and secret, the DB user is least-privilege, and the app-layer checks (which this repo already has) stay rigorous. The first dollar of security budget should go to Vercel Pro + Static IPs, not Atlas.
