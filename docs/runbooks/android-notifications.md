# Android notifications: the FCM sender's credentials

Production sends Firebase Cloud Messaging (FCM) messages with no service-account key (owner decision, 2026-11-07). A Vercel Function's OIDC token is exchanged through Google Workload Identity Federation (WIF) for a short-lived token of one sender service account. That account can do nothing but send FCM messages. The code is `apps/web/src/lib/notifications/google-credentials.ts`; the settings are in [`docs/api.md`](../api.md), "First Expense-added Android alert".

## How it works

1. A send asks `@vercel/oidc`'s `getVercelOidcToken()` for the function's OIDC token. It reads the request's `x-vercel-oidc-token` header, then `VERCEL_OIDC_TOKEN_FILE`, then `VERCEL_OIDC_TOKEN` ([Vercel OIDC reference](https://vercel.com/docs/oidc/reference), "Other cloud providers").
2. google-auth-library exchanges it at `https://sts.googleapis.com/v1/token` for a federated token. The audience is `//iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/<pool-id>/providers/<provider-id>`.
3. The federated token calls `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/<sender-email>:generateAccessToken` for the scope `https://www.googleapis.com/auth/firebase.messaging` only.
4. That access token sends to `https://fcm.googleapis.com/v1/projects/<FCM_PROJECT_ID>/messages:send`. It is cached until it nears expiry.

The client construction follows [Vercel's GCP guide](https://vercel.com/docs/oidc/gcp).

## Vercel's token

Vercel's token claims ([OIDC reference](https://vercel.com/docs/oidc/reference), "OIDC token anatomy"):

| Claim | Value in team issuer mode                                    |
| ----- | ------------------------------------------------------------ |
| `iss` | `https://oidc.vercel.com/<team-slug>`                        |
| `aud` | `https://vercel.com/<team-slug>`                             |
| `sub` | `owner:<team-slug>:project:<project-name>:environment:<env>` |

`<env>` is `development`, `preview`, `production` or a Custom Environment slug. The claims use the team slug and the project name, not their ids, so **renaming the Vercel team or project breaks the exchange** until the provider and the binding below are updated.

## Before you start

- In the Vercel project's settings, turn on **Secure backend access with OIDC federation**, with the issuer mode set to **Team**. Without it, Vercel gives the function no OIDC token, and every send ends `operational`.
- Have `gcloud` signed in as an owner of the Google Cloud project that will hold the pool. The examples below assume that is the Firebase project. If it isn't, run the role grant in step 5 on the Firebase project.

## Setup

Replace each placeholder; none of these values are secrets, but keep them out of the repository.

| Placeholder        | Meaning                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `<project-id>`     | the Firebase / Google Cloud project id (= `FCM_PROJECT_ID`)                                     |
| `<project-number>` | that project's number (`gcloud projects describe <project-id> --format='value(projectNumber)'`) |
| `<pool-id>`        | e.g. `vercel`                                                                                   |
| `<provider-id>`    | e.g. `vercel`                                                                                   |
| `<team-slug>`      | the path in your Vercel team URL                                                                |
| `<project-name>`   | the Vercel project's name                                                                       |
| `<sender-sa>`      | e.g. `fcm-sender`                                                                               |

1. **Enable the APIs.**

   ```sh
   gcloud services enable iam.googleapis.com iamcredentials.googleapis.com \
     sts.googleapis.com fcm.googleapis.com --project=<project-id>
   ```

2. **Create the pool.**

   ```sh
   gcloud iam workload-identity-pools create <pool-id> \
     --project=<project-id> --location=global --display-name="Vercel"
   ```

3. **Create the OIDC provider**, bound to the one Vercel project and environment.

   ```sh
   gcloud iam workload-identity-pools providers create-oidc <provider-id> \
     --project=<project-id> --location=global --workload-identity-pool=<pool-id> \
     --display-name="Vercel" \
     --issuer-uri="https://oidc.vercel.com/<team-slug>" \
     --allowed-audiences="https://vercel.com/<team-slug>" \
     --attribute-mapping="google.subject=assertion.sub" \
     --attribute-condition="assertion.sub == 'owner:<team-slug>:project:<project-name>:environment:production'"
   ```

   The condition refuses every token from any other team, project or environment before it reaches IAM. To let a preview deployment send too (for example to the staging Firebase project), use a separate pool, provider and sender for staging, rather than widening this one.

4. **Create the sender service account**, with no keys.

   ```sh
   gcloud iam service-accounts create <sender-sa> \
     --project=<project-id> --display-name="Splitbook FCM sender"
   ```

5. **Let it send FCM messages and nothing else.** FCM v1's `messages.send` needs `cloudmessaging.messages.create` ([FCM reference](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send)). Prefer a custom role with only that permission. First check that a custom role can hold it:

   ```sh
   gcloud iam list-testable-permissions //cloudresourcemanager.googleapis.com/projects/<project-id> \
     --filter="name=cloudmessaging.messages.create" --format="value(name,customRolesSupportLevel)"
   ```

   If it prints `SUPPORTED` (or nothing after the name, which also means supported), create the role and grant it:

   ```sh
   gcloud iam roles create fcmSender --project=<project-id> \
     --title="FCM sender" --description="Send FCM messages only" \
     --permissions=cloudmessaging.messages.create --stage=GA
   gcloud projects add-iam-policy-binding <project-id> \
     --member="serviceAccount:<sender-sa>@<project-id>.iam.gserviceaccount.com" \
     --role="projects/<project-id>/roles/fcmSender"
   ```

   If it prints `NOT_SUPPORTED`, grant the narrowest predefined role instead:

   ```sh
   gcloud projects add-iam-policy-binding <project-id> \
     --member="serviceAccount:<sender-sa>@<project-id>.iam.gserviceaccount.com" \
     --role="roles/firebasecloudmessaging.admin"
   ```

6. **Let exactly that Vercel subject impersonate the sender.** `principal://…/subject/<sub>` names one subject; a `principalSet://` member would match a group or an attribute value instead.

   ```sh
   gcloud iam service-accounts add-iam-policy-binding \
     <sender-sa>@<project-id>.iam.gserviceaccount.com --project=<project-id> \
     --role="roles/iam.workloadIdentityUser" \
     --member="principal://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/<pool-id>/subject/owner:<team-slug>:project:<project-name>:environment:production"
   ```

7. **Set the Vercel environment variables** for Production (Settings → Environment Variables). Set all four: with only some set, or none on Vercel, nothing is sent, each send logs a configuration error naming the settings, and nothing falls back to Application Default Credentials.

   ```text
   GCP_PROJECT_NUMBER=<project-number>
   GCP_WORKLOAD_IDENTITY_POOL_ID=<pool-id>
   GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=<provider-id>
   GCP_SERVICE_ACCOUNT_EMAIL=<sender-sa>@<project-id>.iam.gserviceaccount.com
   ```

   Redeploy for them to take effect. Never add a `GOOGLE_APPLICATION_CREDENTIALS` key.

## Is it working?

Edits, deletion, restoration and recurring generation also need `ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED=true` (#841). It is off by default; leave it off in production until the owner accepts those alerts. Unsetting it is their rollback: it stops their sends without touching Expense-added alerts or any save.

Payment alerts for recorded Settlements (single, batch and Cross-currency) need `ANDROID_NOTIFICATION_PAYMENTS_ENABLED=true` (#842), independently of the Expense switch above. It is off by default; leave it off in production until the owner accepts Payment alerts. Unsetting it is their rollback: it stops Payment sends without touching Expense alerts or any save.

Turn either switch on only once the phones in use run a build that shows that alert. An older build drops the new kinds without showing anything, but each send still counts as `accepted`, and Android can lower the priority of an app whose high-priority messages show nothing, which can delay its Expense-added alerts.

**Before rolling the code back to a build older than a switch you turned on**, unset that switch and redeploy, then check that no change is still waiting to publish its Activity with a kind the older build doesn't know. An older build can't publish those, so the Group's Activity would miss them and every Activity read would log a recovery error (money and balances are unaffected):

```js
db.settlements.countDocuments({
  'pendingActivity.notificationContext.kind': 'settlement_recorded',
});
db.expenses.countDocuments({
  'pendingActivity.notificationContext.kind': { $in: ['expense_updated', 'expense_deleted'] },
});
```

If either count isn't 0, open those Groups' Activity on the current build to publish them, and check again before rolling back.

With both notification switches on, run one dispatch (`POST /api/notifications/dispatch`, docs/api.md) after an Expense is added. Its log line should count the alert as `accepted`.

- **A log line starting `Firebase sender Workload Identity settings`:** a setting is missing or malformed; the line names which.
- **`failed` with no configuration line:** the exchange was refused. Check, in order, the OIDC federation setting and its issuer mode ("Before you start"), the issuer and audience (step 3), whether the `sub` in the condition and binding matches the team slug, project name and environment exactly (steps 3 and 6), and the sender's role (step 5). Cloud Audit Logs for `sts.googleapis.com` and `iamcredentials.googleapis.com` show the refusal.

Locally, leave the four settings unset: the sender uses Application Default Credentials (`gcloud auth application-default login`).
