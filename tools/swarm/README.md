# tools/swarm

Tooling for agents that each work in their own worktree. It gives each worktree its own fictional backend, runs every gate a ticket needs with one verdict, and checks the install before anything else. Run it from the worktree's root:

```sh
pnpm swarm check   # fail unless the install matches pnpm-lock.yaml
pnpm swarm up      # start this worktree's backend and print its MOBILE_VERIFY_URL
pnpm swarm gate    # run every gate and write tools/swarm/out/verdict.json
pnpm swarm down    # stop this worktree's backend and drop this worktree's databases
```

It is a pnpm workspace package (`@splitbook/swarm`), so the root `pnpm lint`, `pnpm typecheck` and `pnpm test` cover it in CI. It is written with [Effect 4](https://effect.website/docs/v4/getting-started/installation), which ADR 0006 allows only in standalone tooling like this; no package under `apps/` or `packages/` may depend on it, and a unit test checks that. Effect 4 needs TypeScript 5.9 or later with `strict`, and Node 22.18 or later, which also runs the TypeScript sources directly, so the package declares `"node": ">=22.18"` and checks it before loading.

## The shared-resource rule

The backend on port **4138** with database **`splitbook_mobile_50`**, and **emulator-5554**, are shared single resources: one agent at a time uses them. This tool never uses either. Each worktree gets its own backend on a free loopback port with its own database, so worktrees no longer queue for 4138. It adds no emulators: emulator-5554 stays one device, used by one agent at a time.

Every backend shares the one local Mongo server (port 27018 by default), each on its own database. Next allows one `next dev` per app directory, so a worktree runs one backend at a time.

**One swarm command at a time per worktree.** `up`, `down` and `gate` each hold `tools/swarm/out/swarm.lock` while they run, so a gate can't take down a backend an `up` is still starting, and two `up`s can't both start one. A second command is refused with the first one's name and pid; wait for it to finish. The lock names its holder by pid and start time, so a lock left by a command that was killed is replaced, even when its pid has been reused.

## `pnpm swarm check`

Compares `node_modules/.pnpm/lock.yaml`, the lockfile pnpm last installed, with `pnpm-lock.yaml`. It fails when the worktree has no install, or when the two differ, and prints the fix:

```sh
pnpm install --frozen-lockfile --offline   # about 10 s with a warm store
```

Drop `--offline` if a package is missing from the store. A stale install looks like broken code (missing packages fail rendered tests and typecheck), so `up` refuses to start on one and the gate checks it first. `check` loads only Node built-ins, so it runs even where `effect` itself isn't installed.

## `pnpm swarm up`

1. Picks a port the operating system reports free on 127.0.0.1, skipping 4138 and every port the Fetch standard blocks, and a fresh database name with this worktree's prefix (below).
2. Seeds it with the existing fictional seed (`apps/mobile/scripts/dev-backend/seed.mjs`: the web app's demo seed, the Household and the Alex-only Group).
3. Starts the backend (`start.mjs`) through #185's `SPLITBOOK_NATIVE_ORIGIN_PORT`, `SPLITBOOK_NATIVE_DATABASE` and `SPLITBOOK_NATIVE_MONGO_PORT`, in its own process group, and waits until `GET /api/auth/ok` answers.
4. Prints `MOBILE_VERIFY_URL` and the three `SPLITBOOK_NATIVE_*` variables for this backend, and returns. Give the verifiers `MOBILE_VERIFY_URL`, and the backend's controls (`control.mjs`) the three `SPLITBOOK_NATIVE_*` variables, so they act on this worktree's database, never `splitbook_mobile_50`. The backend keeps running until `pnpm swarm down`; its log is `tools/swarm/out/backend.log`.

`up` records the backend in `tools/swarm/out/backend.json` before it seeds, so `down` can always find the database and its Mongo port, and adds the backend's pid and start time once it starts.

When this worktree's backend is already up and answering, `up` prints it again, with what it serves (`next dev` or a production build), instead of starting another. When it is running but not answering (still compiling, or busy), `up` waits for it up to the ready timeout, then refuses; it never tears a running backend down. A record whose backend is gone (after a crash or a reboot) is cleaned up first, as `down` would.

| Flag (or variable)                                     | Default                  | Accepted                                                                             |
| ------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------ |
| `--origin` (or `SPLITBOOK_NATIVE_ORIGIN_PORT`, a port) | a free port on 127.0.0.1 | `http://127.0.0.1:<port>`, a free port from 1024, never 4138 or a Fetch-blocked port |
| `--database` (or `SPLITBOOK_NATIVE_DATABASE`)          | a fresh name             | this worktree's prefix, then `[a-z0-9_]`, 63 characters at most                      |
| `--mongo-port` (or `SPLITBOOK_NATIVE_MONGO_PORT`)      | `27018`                  | the local Mongo server's port                                                        |
| `--ready-timeout <seconds>`                            | 180                      |                                                                                      |
| `--server` (or `SPLITBOOK_NATIVE_SERVER`)              | `dev`                    | `dev` (`next dev`) or `production` (a production build, then `next start`)           |

#185's variables, when set, are requests like the flags: they are checked, never trusted. `up` refuses, before anything connects or starts:

- a database name without the tool's prefix, `splitbook_mobile_50`, a demo database (`splitbook`, `splitbook-demo`), or another worktree's database;
- a database that already exists: `up` never adopts one;
- an origin other than `http://127.0.0.1:<port>`, port 4138, the Mongo port, and a port in use;
- a port the [Fetch standard blocks](https://fetch.spec.whatwg.org/#port-blocking), such as 4190, 5060, 6000, 6665 to 6669, 6697 and 10080. Node's `fetch`, which the verifiers use, refuses those with "bad port" before it connects, so every verifier would fail. The list is Node 22's, and a unit test checks that Node's `fetch` blocks no port missing from it.

A backend that never answers fails `up` after the timeout with a clear error; the backend is stopped and its database dropped. Ctrl-C (or SIGTERM) while `up` runs does the same. If that drop fails, `up` says so and keeps the record, so `pnpm swarm down` can finish it.

The backend's own scripts keep their rules: they refuse root and `apps/web` `.env` files, accept only loopback Mongo and `splitbook_mobile_*` names, and claim a database with the fictional ownership marker. The tool passes them only `PATH` and the three variables above, plus `SPLITBOOK_NATIVE_SERVER` to `start.mjs`; it never reads `.env` files, `MONGODB_URI` or any credential.

**`--server production`** makes `start.mjs` build the web app for the backend's origin, then serve it with `next start` and `ALLOW_DEMO_AUTH=true`, as CI does. Next bakes the origin into the build, so each production `up` builds again, in `apps/web/.next`. A `pnpm web build` in the same worktree overwrites that `.next` while the backend serves it, so run one only after `pnpm swarm down`. The build counts toward the ready timeout and takes about 30 s on this machine when it is quiet (below), so raise `--ready-timeout` on a slow or busy machine. The default, `dev`, runs `next dev`. `up` refuses to switch a running backend to the other server; run `pnpm swarm down` first.

## In CI

**`pnpm swarm gate` is the local CI: run it, and see it pass, before every push.** GitHub Actions then runs one fast check on each pull request and each push to `main`, and the full suite nightly (#277), to stay within the Actions minutes of a private repository. Everything is in `.github/workflows/ci.yml`:

| When                                                                           | What runs                        |
| ------------------------------------------------------------------------------ | -------------------------------- |
| Each push to a pull request, and each push to `main` or `pilot/tanstack-reads` | **PR checks**                    |
| Nightly at 04:17 UTC, a manual run, and a pull request labelled **`full-ci`**  | **PR checks** and the full suite |

- **PR checks** (`pr-checks`) is one job that installs once, then runs the format check, lint, typecheck, the design-system style policy (`pnpm web check:design-system`), the workspace unit tests in UTC, every mobile HTTP verifier (below) and, last, on a pull request, the ceilings ratchet (below). That is the gate without its install check, plus the style policy. It is the one check branch protection requires, so its name, `PR checks`, must not change.
- **The full suite** adds `verify` (the unit and integration tests, the authenticated Playwright suites and the build), `playwright` (the browser journeys, the Google sign-in journeys and the visual comparisons) and the unit tests in three more time zones.
- **A docs-only pull request,** one that changes only Markdown, `docs/` or `.claude/` files, passes PR checks after the format check alone. Prettier formats Markdown and the `docs/` mockups, so that check still runs.
- **A push to `main` runs PR checks only,** on the merged result, since branches needn't be up to date with `main` to merge. The full suite never runs on a push: a merge reaches it in that night's run.
- **`pilot/tanstack-reads`,** the integration branch of ADR 0006's TanStack pilot (#214 to #217), is checked like `main`: each push to it, such as merging `main` into it, runs PR checks only, and a pull request into it runs PR checks with the ceilings ratchet against that branch.
- **A new push cancels** the run of the push before it, on a pull request and on `main` or `pilot/tanstack-reads`. On a branch that run is PR checks only, and the newer commit, which contains it, is checked anyway. Nightly runs and manual runs are never cancelled.
- **The nightly run is skipped** when `main`'s commit has already passed the full suite, in an earlier nightly run or in a manual run. A push run doesn't count, since it doesn't run the full suite. So a night runs the suite when `main` moved since the last full run, or when that run failed.

**To run the full suite on a pull request,** for a risky change such as auth, money, the lockfile or CI itself, do one of these:

- Add the `full-ci` label. The full suite runs when the label is added, then again on each push while the label stays. Adding any other label, or removing any label, only reruns PR checks.
- Run the workflow by hand: `gh workflow run ci.yml --ref <branch>`, or **Run workflow** on the CI workflow's Actions page. A manual run tests the branch's own commit, not its merge into `main`.

**When a run on `main` fails, or a nightly run fails,** GitHub notifies one person; the workflow adds no notifier of its own. A failing nightly run is the first place a merge that breaks the full suite shows up:

- a failed push run goes to whoever pushed; for a merged pull request, that is whoever merged it;
- a failed nightly run goes to whoever last changed the workflow's `cron` line, or whoever last re-enabled the workflow. So the owner merges any pull request that changes that line, #277's included;
- a failed manual run goes to whoever started it.

For that to reach an inbox, the account's notification settings must send Actions notifications by e-mail: in GitHub's Settings, under Notifications, then System, choose e-mail for Actions and tick "Only notify for failed workflows". A failed run also shows as a red cross on its commit on `main` and on the Actions page.

### The ceilings ratchet in PR checks

On a pull request that isn't docs-only, PR checks ends with #206's ratchet, the same script the gate's ceilings step runs:

```sh
pnpm mobile ceilings:compare --base <the merge commit's first parent> \
  --pull-request <number> --repository <owner/name> \
  --approvers <vars.CEILINGS_APPROVERS, or github.repository_owner without it> \
  --labels-json <toJSON(github.event.pull_request.labels.*.name)>
```

It runs last, so a pull request that raises a ceiling still shows its lint, typecheck, test and verifier results before an approver labels it. Like the steps before it, it doesn't run once an earlier step has failed. The step times out after 5 minutes, and each request to GitHub after 30 s, which fails the comparison (exit 2).

- **What it compares.** The render and request ceilings in `apps/mobile/src/render-profile.ceilings.json`, the one data file the render-profile harness reads, with the base's copy. A pull request is checked out merged into its base, and the checkout's depth of 2 already holds the base, so nothing more is fetched.
- **What fails.** Any ceiling that rose, a ceiling that was removed, or a journey removed or renamed. Lowering a ceiling and adding a journey always pass. The output lists each change with both counts, and the failure becomes an annotation on the pull request.
- **An approver's label.** The `re-record-ceilings` label approves a re-record, one pull request at a time. It counts only when both hold: the pull request has the label now (its labels come from the event, passed to the script as JSON through the step's environment, never as shell text), and the latest `labeled` event for it on the pull request's timeline, read page by page, was made by an approver. So a stale `labeled` event can't approve a label that was deleted without an `unlabeled` event, and an old run's event can't approve a label removed since.
- **Approvers.** The logins in the repository variable `CEILINGS_APPROVERS` (Settings, then Secrets and variables, then Actions, then Variables), separated by commas or spaces, with or without `@`, and compared without case. Only a repository admin can set a variable, so a pull request can't widen the list. Without the variable the repository owner (`github.repository_owner`) is the only approver. The list is read only when a re-record needs it, so a malformed value never fails a pull request whose ceilings didn't rise; when one does need it, an empty list or an entry that isn't a login is refused (exit 2), never read as "anyone". A label applied by anyone else leaves the check failing, and the message names who applied it and lists the approvers; an approver removes it and applies it again.
- **GitHub access.** The script asks GitHub only when something rose and the label is on the pull request, with the job's token, so `pr-checks` has `pull-requests: read` (with `contents: read`, which a job's own permissions must repeat).
- **Rerunning.** Adding or removing any label reruns PR checks (`labeled` and `unlabeled`), so an approver's label turns the check green without a push, and removing it fails the check again. Like any label other than `full-ci`, such a run has a concurrency group of its own and never starts or cancels the full suite. Every label event reruns all of PR checks, even for labels nothing reads, and that stays: a skipped required check counts as passing, so skipping PR checks on other labels could turn a red commit green.
- **Docs-only pull requests** skip it: they can't change the data file. A pull request that changes only the data file is not docs-only, so it runs every check.

The label must exist before it can be applied: the owner creates `re-record-ceilings` once, in the repository's labels, and sets `CEILINGS_APPROVERS` when more than the owner's account approves. The re-record steps are in `docs/qa/2026-10-02-android-render-baseline.md`.

### The verifiers in PR checks

PR checks runs every verifier (#228) against a backend of the run's own:

```sh
pnpm swarm up --mongo-port 27017 --server production --ready-timeout 600
TZ=Asia/Kolkata pnpm mobile verify:all   # with MOBILE_VERIFY_URL from up
pnpm swarm down --mongo-port 27017
```

The job's `mongo:7` service listens on 27017, so `up` and `down` name that port; locally the default, 27018, applies. The job adds `up`'s `NAME=value` lines to `GITHUB_ENV`, turns each `FAIL verify:*` line of `verify:all` into an annotation, uploads `tools/swarm/out/backend.log` as the `mobile-verifier-backend-log` artifact when anything fails after `up` started, and always runs `down` once `up` has started. One job runs one swarm command at a time, so the worktree lock never refuses one there.

It serves a production build, as the Playwright jobs do, so no route compiles while a verifier waits; see the timings below. Changing `--server production` to `--server dev` in the job is all it takes to use `next dev` instead.

## `pnpm swarm down`

Stops this worktree's backend and drops **every database whose name starts with this worktree's prefix**, and nothing else:

```text
splitbook_mobile_swarm_<first 10 hex characters of sha256(worktree path)>_<random>
```

`splitbook_mobile_swarm_` is the tool's prefix, inside #185's `splitbook_mobile_` rule. A record naming `splitbook_mobile_50`, a demo database, a name without the tool's prefix or another worktree's database is refused, and nothing is stopped or dropped.

Every drop the tool makes, from `down` or from a failed `up`, goes through one check: the name must start with this worktree's prefix, and the database must hold the fictional ownership marker. A database with this worktree's prefix but no marker is left in place with a warning, and the others are still dropped. When a drop fails (Mongo went away), `down` says so and keeps the record, so it can run again.

It stops a process group (SIGTERM, then SIGKILL after 10 s), so no `next dev` is left behind, only when:

- its leader is this worktree's own `start.mjs`, by absolute path, with the start time recorded when it started. The shared backend, started from the main checkout, has the same command line there, and a reused pid has a later start time, so neither is ever stopped;
- or that leader is gone (killed, or out of memory) and every process left in its group either traces back, through its parents in the group, to a process running from this worktree's `apps/`, such as `next-server` under `next dev`, or is a `next-server` that listens on the recorded port or runs in this worktree's `apps/web`. `next start` retitles its only process `next-server (v…)`, so a production server whose `start.mjs` died names no path; `lsof` (or `/proc` on Linux) gives its port and directory. Otherwise the group is left alone with a warning naming its pids.

When it leaves processes alone and the recorded port is still taken, one of them may be the backend, still using its database. Then `down` drops nothing and keeps the record, and says which processes to look at; once they are gone, run it again. `up` refuses to start a new backend until then.

As it exits, Next starts its own telemetry flush (`next/dist/telemetry/detached-flush.js`) outside that group; it ends by itself within a couple of seconds.

## `pnpm swarm gate`

Runs these steps in the worktree, in order, and prints one verdict:

| Step                          | Command                                                       | Timeout       |
| ----------------------------- | ------------------------------------------------------------- | ------------- |
| install check                 | as `pnpm swarm check`; on failure every other step is skipped | none          |
| lint, typecheck, format check | `pnpm lint`, `pnpm typecheck`, `pnpm format:check`            | 15, 15, 5 min |
| unit tests                    | `pnpm --recursive --workspace-concurrency=1 test:unit`        | 20 min        |
| ceilings                      | `pnpm --dir apps/mobile run ceilings:compare --base <base>`   | 5 min         |
| backend                       | this worktree's backend: the one `up` started, or a new one   | 3 min         |
| `verify:*`, one after another | `pnpm --dir apps/mobile run verify:<name>`                    | 10 min each   |

- **Unit tests, not integration tests.** The web integration tests name their databases per test file, so two worktrees running them at once on one Mongo would share databases. CI's full suite runs them (see [In CI](#in-ci)); the gate never does.
- **vitest workers are capped**, so gates running at once don't fight over the CPU (each vitest run otherwise uses all cores but one). The cap defaults to **2** workers and applies to the whole step: the packages run one after another, each with `VITEST_MAX_WORKERS` set to the cap. Change it per run with `--vitest-workers <n>` or `SWARM_VITEST_WORKERS=<n>`.
- **Verifiers** run one after another, because several assume exclusive use of the Sam persona on their backend (#228), each with `MOBILE_VERIFY_URL` and the three `SPLITBOOK_NATIVE_*` variables set to this worktree's backend, and `TZ=Asia/Kolkata`, which `verify:financial`'s fixtures need. The list is every `verify:*` script in `apps/mobile/package.json` except `verify:all`.
- **No step inherits credentials or another backend.** Steps get the gate's environment without database and auth settings (`MONGO*`, `TEST_MONGO*`, `DATABASE_URL`, `AUTH_*`, `BETTER_AUTH*`, `NEXTAUTH*`, `GOOGLE_*`, `ALLOW_*`, `NEXT_PUBLIC_*`), without anything that looks like a credential (names containing `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `API_KEY`, `PRIVATE_KEY` or `ACCESS_KEY`), and without any `SPLITBOOK_*` or `MOBILE_VERIFY_URL` of another backend.
- **Ceilings.** #206's ratchet, the same script PR checks runs (see [the ceilings ratchet](#the-ceilings-ratchet-in-pr-checks)); the gate calls it, never a copy: `ceilings:compare` in `apps/mobile/package.json`, with the base commit and no pull request. It compares `apps/mobile/src/render-profile.ceilings.json` with the base commit's copy and lists each change. A ceiling that rose, or a journey removed or renamed, exits 1, and the step fails with "needs the re-record-ceilings label from an approver": the gate can't see a label, and needs no approvers, so it reports what CI will refuse until an approver applies it. Any other failure (exit 2: no base commit, a data file that isn't valid) fails the step as "could not be compared". On a branch without the script, the step reports that no ceilings are recorded and is skipped.
- **The backend.** When `up` has started this worktree's backend, the gate uses it and leaves it running. Otherwise it starts one for the verifiers, and stops it and drops its database when it ends.

The gate holds the worktree lock while it runs; when another swarm command holds it, the gate is refused and writes no verdict. A failing step doesn't stop the others (except the install check), and the last lines of its log are printed. Each step's output is in `tools/swarm/out/gate/<step>.log`. A step that passes its timeout is stopped with everything it started and fails. Ctrl-C (or SIGTERM) stops the running step's process group and the backend the gate started, drops its database, and records the verdict as interrupted.

The verdict says pass or fail, with each step's result and time, the worktree's commit and its base commit: the merge-base of `HEAD` with `origin/main` (or `main`), or with `--base <ref>`. `--step-timeout <seconds>` replaces every step's timeout, and `--mongo-port` and `--ready-timeout` work as for `up`. The gate exits non-zero on any failure and writes the same verdict to `tools/swarm/out/verdict.json`:

```json
{
  "verdict": "pass",
  "interrupted": false,
  "worktree": "/path/to/worktree",
  "commit": "<HEAD>",
  "base": { "ref": "origin/main", "commit": "<merge-base>" },
  "startedAt": "2026-10-04T02:31:40.565Z",
  "seconds": 94.5,
  "vitestWorkers": 2,
  "backend": {
    "origin": "http://127.0.0.1:52920",
    "database": "splitbook_mobile_swarm_…",
    "startedByGate": false
  },
  "steps": [
    {
      "name": "lint",
      "status": "pass",
      "seconds": 9.4,
      "log": "/path/to/worktree/tools/swarm/out/gate/lint.log"
    }
  ]
}
```

`status` is `pass`, `fail` or `skip`. The gate covers the behaviour and cost layers of the gate kit; the device layer stays with #194.

## Measured on this machine

Measured on 2026-10-04 on an Apple M3 Pro (11 cores, 36 GB of memory), Node 22.22.2, Next 16.1.6 (`next dev` with Turbopack), Mongo on 127.0.0.1:27018:

- **Time to ready:** 4.8 s for one backend in a fresh worktree, from start to the first answer of `/api/auth/ok`; 4.2 s for another started at the same time in a second fresh worktree; 1.9 s once the worktree's `.next` cache is warm. The seed adds about 2 s before that, so `up` takes about 7 s.
- **Memory:** about 0.9 to 1.1 GB resident for one backend's process group once ready, almost all of it the `next-server` process (0.7 GB with a warm cache), rising to 1.3 to 1.7 GB after a gate has run every verifier against it, since `next dev` keeps every route it compiled. Budget about 1.7 GB per running backend.
- **Two gates at once,** each in its own worktree with its own backend from `up`: both passed, in 82 s and 92 s, with the default cap of 2 vitest workers.

Measured on 2026-10-05 on the same machine for #228: `up`, then `TZ=Asia/Kolkata pnpm mobile verify:all`, from a fresh worktree with no `apps/web/.next`. Seven other agents shared the machine, so the load varied from run to run:

| Load average | `next dev`: `up` + verifiers | Production build: `up` (build included) + verifiers |
| ------------ | ---------------------------- | --------------------------------------------------- |
| low          | 7 s + 53 s = 60 s            | 31 s + 11 s = 42 s, by hand                         |
| about 20     | 9 s + 66 s = 75 s            | 63 s + 22 s = 85 s                                  |
| 24 to 90     | 7 s + 84 s = 91 s            | 92 s + 28 s = 120 s                                 |

The quiet production run predates `--server`: it ran the same steps by hand (the seed, `next build --webpack`, then `next start` with the same environment), with the backend in UTC, as on a CI runner, and every verifier passed.

On a quiet machine the production build is faster, because `next dev` compiles every route the verifiers reach while they wait (the verifiers took 24 s against a warm `next dev`, 11 s against a production build); on a busy one the parallel build suffers most. A CI runner is a quiet machine with 4 cores, where the web app's build takes 40 to 60 s. That holds while the repository is public: GitHub's runners for private repositories have 2 cores, so measure the job again if it goes private. A production backend also uses less memory: about 0.27 GB once the verifiers have run, against 1.1 to 1.7 GB for `next dev`.

Measured on 2026-10-05 on the same machine for #277, at a load average of 5 to 8: PR checks' commands, one after another, took 106 s. The install took 1 s, the format check 7 s, lint 9 s, typecheck 9 s, the style policy 2 s, the unit tests in UTC 35 s (with 3 vitest workers, as on a 4-core runner), `up --server production` 32 s with its build, `verify:all` 12 s and `down` 1 s. On a public 4-core runner the same steps add up to about 3.5 minutes, from the medians of the CI jobs they came from. Measure the job again once the repository is private and its runners have 2 cores.

## Files

Everything the tool writes is under `tools/swarm/out/`, which the root `.gitignore` already ignores (`out/`): `swarm.lock` (while a command runs), `backend.json` (the backend), `backend.log`, `verdict.json` and `gate/<step>.log`.

## Tests

```sh
pnpm --filter @splitbook/swarm test
```

The unit tests drive each command's public function (`up`, `down`, `gate`, `checkInstall`) with fake processes, Mongo and network, and real fixture directories. `src/live.test.ts` runs `up` and `gate` on real processes, with stand-in backend scripts that never become ready, to show that a timeout or an interruption leaves no process behind, and tests the live services' guards: the drop check, `ps` start times and process groups, and Node's blocked ports. No test needs a Mongo server.
