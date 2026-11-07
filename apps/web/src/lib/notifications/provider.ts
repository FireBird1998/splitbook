import { GoogleAuth } from 'google-auth-library';

export interface FcmRequest {
  token: string;
  data: { title: string; message: string; body: string; channelId: string };
  android: { ttl: string; priority: 'high'; collapse_key: string };
}
export type SendOutcome =
  | 'accepted'
  | 'temporary'
  | 'invalid-token'
  | 'operational'
  | 'uncertain'
  | 'ineligible';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
/** Only external boundary replaced by HTTP acceptance tests. ADC belongs to the server owner. */
function withinSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Notification deadline expired'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function sendFcm(
  message: FcmRequest,
  signal: AbortSignal,
  authorize: () => Promise<boolean> = async () => true,
): Promise<SendOutcome> {
  if (signal.aborted) return 'operational';
  const project = process.env.FCM_PROJECT_ID;
  if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project)) return 'operational';
  let authorization: string;
  try {
    const client = await withinSignal(auth.getClient(), signal);
    const token = await withinSignal(client.getAccessToken(), signal);
    if (!token.token) return 'operational';
    authorization = 'Bearer ' + token.token;
  } catch {
    return 'operational';
  }
  if (signal.aborted) return 'operational';
  let dispatched = false;
  try {
    if (!(await withinSignal(authorize(), signal))) return 'ineligible';
    if (signal.aborted) return 'operational';
    const expiresAt = Date.parse(JSON.parse(message.data.body).expiresAt);
    if (!Number.isFinite(expiresAt)) return 'operational';
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'ineligible';
    const currentMessage = {
      ...message,
      // Expo SDK 58 does not invoke its foreground handler for data-only messages.
      notification: { title: 'Splitbook', body: 'An Expense was added.' },
      android: {
        ...message.android,
        ttl: Math.floor(remaining / 1000) + 's',
        notification: { channel_id: 'ledger-updates' },
      },
    };
    dispatched = true;
    const response = await fetch(
      'https://fcm.googleapis.com/v1/projects/' + project + '/messages:send',
      {
        method: 'POST',
        signal,
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currentMessage }),
      },
    );
    if (response.ok) return 'accepted';
    if (response.status === 429 || response.status >= 500) return 'temporary';
    // Consume only bounded known fields; never log or persist Google's body.
    if (response.status === 404 || response.status === 400) {
      const body: unknown = await response.json().catch(() => null);
      const serialized = JSON.stringify(body);
      if (serialized.includes('"UNREGISTERED"')) return 'invalid-token';
    }
    return 'operational';
  } catch {
    return dispatched ? 'uncertain' : 'operational';
  }
}
