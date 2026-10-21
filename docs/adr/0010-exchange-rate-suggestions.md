---
status: accepted
date: 2026-10-21
---

# Server-cached exchange rates suggest a payment rate; the ledger never converts

Authority: [spec #710](https://github.com/FireBird1998/splitbook/issues/710) and
[service ticket #726](https://github.com/FireBird1998/splitbook/issues/726).
This supersedes the **no external FX API** decision in the
[July hardening design](../superpowers/specs/2026-07-09-app-hardening-design.md).
That document remains a historical record. This ADR does not change recorded Expenses,
Settlements, Balances, Debts or Suggested payments: the ledger keeps amounts in their own
currencies and never converts or revalues them. A suggestion is informational, not a save.
Cross-currency Settlement storage and payment maths belong to later #710 tickets.

## Sources and terms

- **Primary: Frankfurter v2**, the default blended feed at
  `https://api.frankfurter.dev/v2/rates?base=USD`. Its
  [documentation](https://frankfurter.dev/) permits commercial use of blended rates and local
  caching, without a key. Direct central-bank provider endpoints have their own terms; this
  service does not use those endpoints. Each row keeps its own provider date.
- **Fallback: ExchangeRate-API open access**, at
  `https://open.er-api.com/v6/latest/USD`. The
  [open-access documentation](https://www.exchangerate-api.com/docs/free) permits caching and
  requires the linked text **Rates By Exchange Rate API** wherever its rates appear, linking
  to `https://www.exchangerate-api.com`. Its
  [terms](https://www.exchangerate-api.com/terms) prohibit redistribution, including products
  offering programmatic access to the provider's data. We use it only for the app's own
  members' payment suggestions, never as a general rate API or an assistant tool.

Both providers sit behind `RateProvider.fetchTable()`, returning units per USD as decimal
strings and provider calendar dates. No user, Group, amount or credential is sent to either
provider. Provider calls are server-only, fixed-origin, bounded to eight seconds and 128 KiB,
with redirects refused. No phone or browser contacts a provider.

## Daily cache and fallback

A Vercel cron GET at `/api/cron/exchange-rates` runs once daily (`0 18 * * *`, UTC).
[Vercel sends the configured cron secret as bearer authorization](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
The route refuses missing, incorrect or unconfigured credentials, including when a browser
has a valid session. Only this exact cron GET bypasses the proxy's session-cookie check;
its own secret guard is mandatory. The cron reply contains status/counts, never rates.

MongoDB holds one singleton table in `exchangeratetables`. Each selected currency has its
USD rate, source, provider as-of day and actual fetch instant. A database day claim prevents
duplicate or concurrent invocations from fetching again that UTC day. An older job cannot
replace a newer day's table. An interrupted attempt is retried on the next daily invocation,
not by a member read; the previous table remains readable within the freshness limit.

The job fetches one primary table. If any supported currency is missing, invalid, future-dated
or **more than three UTC calendar days old**, it fetches one fallback table and chooses that
currency from the fallback. Exactly three days old is still usable. Other currencies keep
the primary rate. A stale fallback is also refused. USD is the common unit, not a fetched
quote. Only the 30 supported currencies are retained.

If neither source supplies a usable replacement, a previously stored quote keeps its real
source and timestamps. If a whole refresh gets zero fresh supported quotes from both
providers, cron answers **502** with `refreshed: false` and `reason: providers_unavailable`,
and logs the fresh and usable-saved currency counts without rate data. The day remains
claimed, so retries wait until the next daily invocation. Reads check age again, so a missed
job cannot serve old rates indefinitely. An empty cache, missing currency or stale pair yields no suggestion with a
reason. No outage blocks the future member-entered-rate flow.

Cross rates divide the two USD legs from this one table, using decimal integer arithmetic
and rounding half up to at most 12 decimal places. The response is a decimal string, not a
binary money amount. A cross rate can have two sources: it reports `mixed`, preserves both
legs' provenance, and uses the older as-of day and fetch time for its headline age. If
**either leg** is fallback, attribution is required for the result, including inverse rates.

## Read boundary and assistant isolation

`GET /api/groups/[id]/rates?from=EUR&to=INR` requires the app session and current Group
membership. It returns one suggestion, its provenance and attribution, or a no-suggestion
reason; no bulk-table endpoint exists. All responses are private/no-store. It accepts any
pair in the supported registry, including legacy debt currencies; Group currency editing
and Settlement validation remain separate responsibilities.

MCP bearer tokens do not authorize this app route. No MCP tool imports the rate service or
cache, and the existing tool replies explicitly select ledger fields. The integration test
populates a fallback cache, verifies that the app member receives attribution, and exercises
all ledger tools through the actual SDK and MCP handler without external HTTP. It checks
that no rate, source or attribution leaks and that an invented rate tool is refused. Future
Settlement/export work must preserve this boundary when it stores suggested-rate provenance.

## Deployment and verification

The owner must set **`CRON_SECRET`** on the production web project; do not record its value.
The daily cron definition is committed in `apps/web/vercel.json`. The owner deploys it;
merging still does not enable automatic main deployments. No provider key, paid plan or new
runtime is needed. Vercel schedules production deployments; local checks invoke the handler
with a fictional secret and fake providers. Production was not configured by this change.

Tests use fake providers and fictional HTTP responses, never provider endpoints. They cover
primary success, outages, stale/missing currencies, mixed provenance, attribution, exhausted
sources, cache ageing, membership refusal, cron authentication/concurrency and assistant
isolation. Route integration tests use their own MongoDB replica set.
