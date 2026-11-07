import { getVercelOidcToken } from '@vercel/oidc';
import {
  ExternalAccountClient,
  GoogleAuth,
  type ExternalAccountClientOptions,
} from 'google-auth-library';

/**
 * The FCM sender's Google credentials. Production holds no service-account key: a Vercel
 * Function's OIDC token is exchanged through Google Workload Identity Federation for a token of
 * the sender service account (docs/runbooks/android-notifications.md). With none of the four
 * settings present, local and dev keep Application Default Credentials; on Vercel (`VERCEL` set)
 * that is a configuration error instead. With only some present, the sender fails closed and
 * never falls back to Application Default Credentials.
 */
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

const SETTINGS = [
  'GCP_PROJECT_NUMBER',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
  'GCP_SERVICE_ACCOUNT_EMAIL',
] as const;
type Setting = (typeof SETTINGS)[number];

// Pool and provider ids are 4–32 lowercase letters, digits or hyphens. Each value lands in a URL,
// so anything else is refused rather than escaped.
const FORMATS: Record<Setting, RegExp> = {
  GCP_PROJECT_NUMBER: /^\d{1,20}$/,
  GCP_WORKLOAD_IDENTITY_POOL_ID: /^[a-z0-9-]{4,32}$/,
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: /^[a-z0-9-]{4,32}$/,
  GCP_SERVICE_ACCOUNT_EMAIL: /^[a-z0-9-]+@[a-z0-9.-]+\.gserviceaccount\.com$/,
};

export type GoogleCredentialConfig =
  | { kind: 'application-default' }
  | {
      kind: 'workload-identity';
      projectNumber: string;
      poolId: string;
      providerId: string;
      serviceAccountEmail: string;
    };

/** A deployment's sender settings are unusable. Its message names settings, never their values. */
export class GoogleCredentialConfigError extends Error {
  override name = 'GoogleCredentialConfigError';
}

export function googleCredentialConfig(): GoogleCredentialConfig {
  const values = Object.fromEntries(
    SETTINGS.map((name) => [name, process.env[name]?.trim() ?? '']),
  ) as Record<Setting, string>;
  const missing = SETTINGS.filter((name) => !values[name]);
  if (missing.length === SETTINGS.length) {
    // A Vercel Function has no Application Default Credentials: on Vercel, unset is a mistake to
    // log, not a reason to try ADC and end each send as an unexplained operational failure.
    if (process.env.VERCEL?.trim()) {
      throw new GoogleCredentialConfigError(
        'Firebase sender Workload Identity settings are missing on Vercel: set ' +
          SETTINGS.join(', ') +
          '.',
      );
    }
    return { kind: 'application-default' };
  }
  if (missing.length > 0) {
    throw new GoogleCredentialConfigError(
      'Firebase sender Workload Identity settings are incomplete: set all of ' +
        SETTINGS.join(', ') +
        ', or none to use Application Default Credentials. Missing: ' +
        missing.join(', ') +
        '.',
    );
  }
  const malformed = SETTINGS.filter((name) => !FORMATS[name].test(values[name]));
  if (malformed.length > 0) {
    throw new GoogleCredentialConfigError(
      'Firebase sender Workload Identity settings are invalid. Malformed: ' +
        malformed.join(', ') +
        '.',
    );
  }
  return {
    kind: 'workload-identity',
    projectNumber: values.GCP_PROJECT_NUMBER,
    poolId: values.GCP_WORKLOAD_IDENTITY_POOL_ID,
    providerId: values.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
    serviceAccountEmail: values.GCP_SERVICE_ACCOUNT_EMAIL,
  };
}

/**
 * The function's Vercel OIDC token. `getVercelOidcToken` reads the request's
 * `x-vercel-oidc-token` header, then `VERCEL_OIDC_TOKEN_FILE`, then `VERCEL_OIDC_TOKEN`
 * (https://vercel.com/docs/oidc/reference). It is read on every exchange and never cached.
 */
export async function vercelSubjectToken(): Promise<string> {
  let token: string | undefined;
  try {
    token = await getVercelOidcToken();
  } catch {
    token = undefined;
  }
  // The upstream error is dropped: the message below is the whole diagnosis, and nothing a token
  // lookup returns reaches a log.
  if (!token) {
    throw new Error(
      'Vercel OIDC token is unavailable: enable OIDC federation for this Vercel project.',
    );
  }
  return token;
}

/** The client options of https://vercel.com/docs/oidc/gcp, narrowed to the FCM scope. */
export function workloadIdentityClientOptions(
  config: Extract<GoogleCredentialConfig, { kind: 'workload-identity' }>,
): ExternalAccountClientOptions {
  return {
    type: 'external_account',
    audience:
      `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/` +
      `workloadIdentityPools/${config.poolId}/providers/${config.providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url:
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
      `${config.serviceAccountEmail}:generateAccessToken`,
    scopes: [FCM_SCOPE],
    subject_token_supplier: { getSubjectToken: () => vercelSubjectToken() },
  };
}

export interface FcmCredentialClient {
  getAccessToken(): Promise<{ token?: string | null }>;
}

// One source per configuration, kept across sends: both cache their access token until it nears
// expiry. Each also shares one pending refresh between callers, so a send that gives up on a stalled
// lookup discards its source (forgetFcmCredentialClients), and the next send starts afresh.
let applicationDefault: GoogleAuth | undefined;
const federated = new Map<string, FcmCredentialClient>();

/** The access-token source for FCM sends. Rejects with GoogleCredentialConfigError when unusable. */
export async function fcmCredentialClient(): Promise<FcmCredentialClient> {
  const config = googleCredentialConfig();
  if (config.kind === 'application-default') {
    applicationDefault ??= new GoogleAuth({ scopes: [FCM_SCOPE] });
    return applicationDefault.getClient();
  }
  const key = JSON.stringify(config);
  let client = federated.get(key);
  if (!client) {
    const built = ExternalAccountClient.fromJSON(workloadIdentityClientOptions(config));
    if (!built) {
      throw new GoogleCredentialConfigError(
        'Firebase sender Workload Identity client could not be built.',
      );
    }
    client = built;
    federated.set(key, client);
  }
  return client;
}

/** Drops the kept sources after an abandoned lookup, so a stalled refresh holds up no later send. */
export function forgetFcmCredentialClients(): void {
  applicationDefault = undefined;
  federated.clear();
}
