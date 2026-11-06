import { createHash, randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { AuthDatabaseWatch, connectMongo, getAuthDb } from '@/lib/mongodb-client';
import { readJson, serverError, validationError } from '@/lib/utils/api-response';
import { ObjectId } from 'mongodb';

const id = z.string().uuid();
const proof = z.string().min(32).max(256);
const update = z
  .object({
    installationId: id,
    installationKey: proof,
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    expenseUpdates: z.boolean().optional(),
    payments: z.boolean().optional(),
    token: z.string().min(1).max(4096).optional(),
  })
  .strict();
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, X-Expected-Account, X-Installation-Key',
};
const answer = (data: unknown, status = 200) =>
  NextResponse.json({ data, status }, { status, headers: privateHeaders });
const refusal = (error: string, status: number) =>
  NextResponse.json({ error, status }, { status, headers: privateHeaders });
const privateResult = (response: Response) => {
  Object.entries(privateHeaders).forEach(([key, value]) => response.headers.set(key, value));
  return response;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const available = () => process.env.ANDROID_NOTIFICATIONS_ENABLED === 'true';
const environment = () =>
  process.env.MOBILE_APP_ENV ||
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');
type Registration = {
  environment: string;
  installationId: string;
  keyHash: string;
  accountId: string;
  sessionId: string;
  binding: string;
  expiresAt: Date;
  enabled: boolean;
  expenseUpdates: boolean;
  payments: boolean;
  revision: number;
  activation: string | null;
  expenseActivation?: string | null;
  expenseCutoff: Date | null;
  paymentCutoff: Date | null;
  token?: string;
  tokenHash?: string;
};
const off = (revision = 0) => ({
  available: available(),
  enabled: false,
  expenseUpdates: false,
  payments: false,
  revision,
  activation: null,
  expenseCutoff: null,
  paymentCutoff: null,
});
const publicState = (r: Registration) => ({
  available: available(),
  enabled: r.enabled,
  expenseUpdates: r.expenseUpdates,
  payments: r.payments,
  revision: r.revision,
  activation: r.activation,
  binding: r.binding,
  expenseActivation: r.expenseActivation ?? r.activation,
  expenseCutoff: r.expenseCutoff?.toISOString() ?? null,
  paymentCutoff: r.paymentCutoff?.toISOString() ?? null,
});
async function identity() {
  const h = await headers();
  const watch = new AuthDatabaseWatch();
  const session = await watch
    .run(() => auth.api.getSession({ headers: h, query: { disableCookieCache: true } }))
    .catch((error) => {
      throw watch.failure(error);
    });
  if (!session?.user?.id || !session.session?.id) return null;
  const expected = h.get('X-Expected-Account');
  if (expected && expected !== session.user.id) return null;
  return session;
}
async function collections() {
  const client = await connectMongo();
  const db = getAuthDb();
  const registrations = db.collection<Registration>('notificationRegistrations');
  await registrations.createIndex({ environment: 1, installationId: 1 }, { unique: true });
  await registrations.createIndex(
    { environment: 1, tokenHash: 1 },
    { unique: true, partialFilterExpression: { enabled: true } },
  );
  await registrations.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return { client, registrations, sessions: db.collection('sessions') };
}
export async function GET(req: Request) {
  try {
    const member = await identity();
    if (!member) return refusal('Unauthorized', 401);
    const installationId = id.safeParse(new URL(req.url).searchParams.get('installationId'));
    const installationKey = proof.safeParse(req.headers.get('X-Installation-Key'));
    if (!installationId.success) return privateResult(validationError(installationId.error));
    if (!installationKey.success) return privateResult(validationError(installationKey.error));
    const { registrations } = await collections();
    const row = await registrations.findOne({
      environment: environment(),
      installationId: installationId.data,
    });
    if (!row) return answer(off());
    if (row.keyHash !== hash(installationKey.data)) return refusal('Forbidden', 403);
    if (
      row.accountId !== member.user.id ||
      row.sessionId !== member.session.id ||
      row.expiresAt <= new Date()
    )
      return answer(off(row.revision));
    return answer(publicState(row));
  } catch (error) {
    return privateResult(serverError(error));
  }
}
export async function POST(req: Request) {
  try {
    const member = await identity();
    if (!member) return refusal('Unauthorized', 401);

    const input = update.safeParse(await readJson(req));
    if (!input.success) return privateResult(validationError(input.error));
    const body = input.data;
    if (body.enabled && !available()) return refusal('Notifications are not available yet.', 503);
    const { client, registrations, sessions } = await collections();
    const transaction = client.startSession();
    try {
      return await transaction.withTransaction(async () => {
        const options = { session: transaction };
        // Touch the live persisted session in this transaction: revocation cannot race a new binding.
        const live = await sessions.updateOne(
          {
            _id: new ObjectId(member.session.id),
            userId: new ObjectId(member.user.id),
            expiresAt: { $gt: new Date() },
          },
          { $set: { notificationCheckedAt: new Date() } },
          options,
        );
        if (!live.matchedCount) return refusal('Unauthorized', 401);
        const filter = { environment: environment(), installationId: body.installationId };
        const previous = await registrations.findOne(filter, options);
        if (previous && previous.keyHash !== hash(body.installationKey))
          return refusal('Forbidden', 403);
        const same =
          previous?.accountId === member.user.id &&
          previous.sessionId === member.session.id &&
          previous.expiresAt > new Date();
        const prior = same ? previous : null;
        if (body.revision !== (previous?.revision ?? 0))
          return refusal('Notification settings changed. Retry.', 409);
        const enabling = body.enabled && !prior?.enabled;
        const expenseUpdates =
          body.enabled &&
          (enabling ? true : (body.expenseUpdates ?? prior?.expenseUpdates ?? true));
        const payments =
          body.enabled && (enabling ? true : (body.payments ?? prior?.payments ?? true));
        const token = body.token ?? prior?.token;
        if (body.enabled && !token)
          return refusal('Notification registration needs a device token.', 400);
        const now = new Date();
        const activate =
          enabling || (expenseUpdates && !prior?.expenseUpdates) || (payments && !prior?.payments);
        const row: Registration = {
          ...filter,
          keyHash: hash(body.installationKey),
          accountId: member.user.id,
          sessionId: member.session.id,
          binding: prior?.binding ?? randomUUID(),
          expiresAt: new Date(member.session.expiresAt),
          enabled: body.enabled,
          expenseUpdates,
          payments,
          revision: (previous?.revision ?? 0) + 1,
          expenseActivation:
            expenseUpdates && (enabling || !prior?.expenseUpdates)
              ? randomUUID()
              : (prior?.expenseActivation ?? prior?.activation ?? null),
          activation: activate ? randomUUID() : (prior?.activation ?? null),
          expenseCutoff:
            expenseUpdates && (enabling || !prior?.expenseUpdates)
              ? now
              : (prior?.expenseCutoff ?? null),
          paymentCutoff:
            payments && (enabling || !prior?.payments) ? now : (prior?.paymentCutoff ?? null),
          ...(token ? { token, tokenHash: hash(token) } : {}),
        };
        // Consent belongs to this explicit opt-in, never to another registration holding the token.
        if (body.enabled)
          await registrations.updateMany(
            {
              environment: row.environment,
              tokenHash: row.tokenHash,
              installationId: { $ne: row.installationId },
              enabled: true,
            },
            {
              $set: { enabled: false, expenseUpdates: false, payments: false },
              $inc: { revision: 1 },
            },
            options,
          );
        if (previous) await registrations.replaceOne(filter, row, options);
        else await registrations.insertOne(row, options);
        return answer(publicState(row));
      });
    } finally {
      await transaction.endSession();
    }
  } catch (error) {
    return privateResult(serverError(error));
  }
}
