# Android transparent POST resend (found during #105 QA)

During emulator QA for [#105](https://github.com/FireBird1998/splitbook/issues/105), a loopback proxy forwarded `POST /api/groups/:id/settlements`, let the server reply 201, and then destroyed the client socket without sending the reply. The proxy saw a second, identical POST a moment later, and the app reported "Payment recorded" without ever seeing a failure. The request carried an `Idempotency-Key`, so the server returned the same Settlement and the ledger showed one payment. When the proxy instead held the reply past the controller's 20 s timeout, nothing was resent.

This change is based on `main` at `d8eff42`, after #137 (cached reads) and #139 (form corrections). It keeps #139's field validation before anything is sent, and #137's Groups/Home read invalidation after every create attempt.

## Mechanism

The HTTP client resends the request, not the app:

- `apps/mobile/src/runtime.ts` passes `fetch` from `expo/fetch` to the controller.
- On Android, `ExpoFetchModule` builds its client with React Native's `OkHttpClientProvider.createClient(reactContext)`. It adds two interceptors and never calls `retryOnConnectionFailure(false)`. React Native's default builder sets only zero timeouts, a cookie jar and a cache, so OkHttp's default applies: **retry on connection failure is on**.
- `NativeRequest.start` copies that client for each request and changes only cookies and redirects. `NativeRequestInit` carries only credentials, headers, method and redirect. **JavaScript cannot turn the retry off.**
- The dev APK ships **OkHttp 4.12.0**, read from the version string in its dex files. React Native declares 4.9.2, and dependency resolution raises it.
- In OkHttp 4.12.0, `RetryAndFollowUpInterceptor.recover()` does not check the HTTP method. It retries a buffered request body when:
  - retries are on;
  - the error is recoverable ("unexpected end of stream" is a plain `IOException`, so it is);
  - `ExchangeFinder.retryAfterFailure()` finds another route.
- A **pooled** connection skips route selection, so `retryAfterFailure()` assumes a route exists and the POST is resent on a new socket. On a fresh connection to a single-address host there is no other route, so the error surfaces. A host with several addresses, such as a CDN, can also be retried on a fresh connection.

### Reproduction outside the app

This was a JVM harness in the scratchpad, not committed. It used OkHttp 4.12.0 and a client built the way `OkHttpClientProvider.createClientBuilder()` builds one. A loopback proxy forwarded to a stub origin that counts created records, and dropped the reply to the first matching POST after the origin had answered 201.

| Scenario                                      | Proxy log                                                             | Client saw                              | Records created |
| --------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- | --------------- |
| Default client, pooled connection (GET first) | POST on socket s1 → 201 dropped; identical POST on s3 → 201 delivered | `HTTP 201`                              | **2**           |
| Default client, fresh connection              | POST → 201 dropped                                                    | `IOException: unexpected end of stream` | 1               |
| `retryOnConnectionFailure(false)`, pooled     | POST → 201 dropped                                                    | `IOException: unexpected end of stream` | 1               |

The app makes several reads before any write, so its writes normally go out on pooled connections. That matches the device observation.

## Write audit

| Write                                                                                                     | Protection on `main`                                                                                                                             | Effect of a transparent resend                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expense create `POST /api/groups/:id/expenses`                                                            | `Idempotency-Key` from a durable `{key, body}` attempt; unique `(group, createdBy, creationRequest.key)` index and fingerprint check             | Server returns the same Expense. **Safe.**                                                                                                                                                                                                                      |
| Expense edit `PATCH` / delete `DELETE /api/groups/:id/expenses/:expenseId`                                | `If-Match` revision; stale revision → 409 `STALE_REVISION`                                                                                       | Nothing is applied twice. The resend gets 409, the app reconciles and shows the saved record as a conflict (or "has been deleted") although the change was the member's own. This is the same state a lost response already produces. **Safe, confusing copy.** |
| Settlement `POST /api/groups/:id/settlements`                                                             | `Idempotency-Key` from a durable attempt; same index and fingerprint check                                                                       | Server returns the same Settlement. **Safe** (the #105 observation).                                                                                                                                                                                            |
| Group create `POST /api/groups`                                                                           | **None**                                                                                                                                         | **A second Group is created**, and the app opens the second one. An explicit retry after an uncertain create also sent a new unkeyed POST. **Unsafe; fixed here.**                                                                                              |
| Join `POST /api/join/:code`                                                                               | Membership check: an existing member gets 200 "Already a member" with the same `groupId`                                                         | **Safe.**                                                                                                                                                                                                                                                       |
| Invite link `POST /api/groups/:id/invite-link`                                                            | None. Every POST rotates the code. The app only POSTs when no active link exists, and after an uncertain POST it reads instead of posting again. | The code rotates twice. The app shows the code from the reply it received, which is the current one, and the first code was never shown. **Safe.**                                                                                                              |
| Development persona sign-in `POST /api/auth/demo-persona/sign-in`, Google `POST /api/auth/sign-in/social` | None                                                                                                                                             | A second session is created. The first session's cookie never reaches the app and is left to expire. The unique email index prevents a duplicate user. **Benign.**                                                                                              |
| Sign-out `POST /api/auth/sign-out`                                                                        | Deleting a session that is already gone succeeds                                                                                                 | **Safe.**                                                                                                                                                                                                                                                       |

## Fix: an idempotency key for Group creation

This is the smallest change that closes the only resend that duplicates data. It also makes the member's own explicit retry safe. A key is needed whatever the transport does: a lost reply on a fresh connection, or the 20 s timeout, leaves the create uncertain, and "Create" was then sent again without a key.

- **Server:**
  - `POST /api/groups` reads `Idempotency-Key` with the existing `parseIdempotencyKey`. An invalid key → 422.
  - `groupService.create` stores the key in a private `creationRequest`, using the same schema and fingerprint as Expense and Settlement creation.
  - A replay by the same creator with the same details returns the existing Group, with no second Group and no second `group_created` Activity.
  - Different details under a used key → 409 `IDEMPOTENCY_CONFLICT`.
  - Concurrent same-key requests converge through the unique partial index `(createdBy, creationRequest.key)` on `groups`. `ensureLedgerWriteIndexes` creates it, as it does for the other creation indexes.
  - A replay by a creator who is no longer a member → 403.
  - `creationRequest` never appears in a Group response.
  - Unkeyed requests from the web app behave as before.
- **Android:**
  - `GroupCreation.attempt` holds `{key, body}` for the last submission.
  - Create reuses the key only when the serialized details are identical. Changed details get a new key, and success or Discard clears the attempt.
  - The key lives exactly as long as the in-memory form. It is not persisted, so there is no offline write queue.
  - If no key can be generated, nothing is sent.
  - The uncertain-create flow is unchanged: Create stays blocked until the member has checked their Groups. After that, an unchanged retry opens the Group that already exists.

Transport retries are left on. With every non-idempotent create keyed, a resend returns the same record, which is the result an explicit retry would reach. See "Follow-ups" for the stricter option.

## Verification

- **Server integration** (`group.service.integration.test.ts`, 5 new tests against local MongoDB):
  - a same-key replay returns the same Group, with one Group and one Activity;
  - the response has no `creationRequest`;
  - concurrent same-key creates converge on one Group, using the insert barrier from the ledger recovery tests;
  - a reused key with different details is refused;
  - keys are scoped to their creator;
  - unkeyed creates still create.
  - **Mutation check:** with the duplicate-key recovery disabled, the concurrency test fails with E11000.
- **Controller** (`mobile-controller.test.ts`, 3 new tests):
  - a lost reply, then check and resume, then an explicit retry sends the same key and body twice, creates one Group and opens it;
  - changed details get a new key;
  - with no key generator, nothing is sent and the form is kept.
- **Real HTTP** (`verify:groups` against this branch's server on a loopback port, fictional database `splitbook_mobile_50`): 9 checks passed, 3 run-owned Groups archived. Two checks are new:
  - "Explicit retry of a committed create returns the same Group";
  - "Transport-level resend of a committed create saves one Group". The transport sends the identical request twice, as OkHttp does, and the first send has committed before the second.
- **Workspace:** typecheck, lint and Prettier pass. Tests: shared 268, web unit 139, web integration 146, mobile 329.

## Emulator evidence

**Setup:**

- Dev APK on `emulator-5554`, running this branch's JavaScript from Metro.
- Device port 4140 was reversed to a host proxy, which drops the reply to one `POST /api/groups` after the server has answered. Its keep-alive was 120 s, so the app's connections stay pooled as they would against a production server.
- The proxy forwarded either to a `main` backend (before) or to this branch's backend (after). Both were fictional backends on `splitbook_mobile_50`, signed in as Alex.

**Before (`main` server), one tap on "Create household":**

- **Proxy log:** `POST /api/groups` on pooled socket s1 → 201, reply dropped. 45 ms later an identical POST went out on new socket s6 → 201, reply delivered.
- **App:** no error; it opened the Group.
- **Database:** two "QA resend before 0504" Groups, created 54 ms apart.
- **Groups list** after a pull: the count went from 03 to 05, with two identical cards.

**After (this branch's server), same app and proxy:**

- **Proxy log:** a dropped POST on pooled s6, then an identical resend on s11, both with key `35eb184a-…`.
- **App:** it opened the Group.
- **Database:** **one** "QA resend after 0508" Group.
- **Groups list:** the count went from 05 to 06.

All three QA Groups were archived afterwards, through the API as Alex. Screenshots are local artifacts and are not committed.

## Not verified

- **An explicit retry after an uncertain create, on the device.** It needs a reply held past the 20 s timeout. It is covered at controller level and against the real server in `verify:groups`.
- **Production (HTTPS / HTTP/2).** OkHttp's HTTP/2 retry paths were not exercised. The audit does not depend on the transport, because every create that could duplicate is now keyed.
- **Physical phone.** Not checked.

## Follow-ups (not in this change)

- **Optional transport hardening.** Turning off OkHttp connection-failure retries for non-GET requests would make every lost write reply surface as the explicit uncertain state. Two ways:
  - a one-line pnpm patch to `expo`'s `NativeRequest.start`, calling `retryOnConnectionFailure(false)` when the method is not GET or HEAD;
  - an `OkHttpClientFactory` installed from `MainApplication` by a config plugin. It must keep React Native's `ReactCookieJarContainer`, because `ExpoFetchModule` casts to it.

  Either needs a native rebuild. It trades today's silent same-key recovery for more uncertain states, and GET reads keep their stale-connection recovery only with the per-method variant.

- **The web client** does not send `Idempotency-Key` for Group creation. Browsers can also resend a POST on a reused connection.
- **Expense edit/delete.** After a lost reply, the app could recognize that the latest saved record is its own mutation (revision + 1 with matching fields) instead of presenting a conflict.
