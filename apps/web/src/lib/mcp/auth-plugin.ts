import { assistantForApproval, connectionName } from './assistant-name';
import { randomUUID } from 'node:crypto';
import type { AuthContext, BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from 'better-auth/api';
import { jwt } from 'better-auth/plugins/jwt';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { getOAuthProviderState, verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { z } from 'zod';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import type { AuthEnv } from '@/lib/auth/create-auth';
import {
  MCP_DRAFT_SCOPE,
  MCP_LEDGER_SCOPE,
  MCP_SCOPES,
  MCP_REFRESH_TOKEN_SECONDS,
  mcpResource,
  mcpUnavailable,
} from './config';
import {
  currentMcpGrant,
  isMcpConnectionExpired,
  liveMcpConsent,
  requireMcpMember,
  type McpConnection,
  type McpConsent,
} from './grants';
import {
  commitExcludedGroups,
  consentRequestKey,
  excludedGroupsSchema,
  holdExcludedGroups,
  liveExcludedGroups,
} from './excluded-groups';
import { PRODUCT_NAME } from '@/lib/product';

export function mcpAuthPlugins(env: AuthEnv) {
  const resource = mcpResource(env);
  if (!resource) return [];
  // Disable MCP plugins on a bad staging timeout; ordinary auth must still initialize.
  if (mcpUnavailable(env)) return [];
  let context: AuthContext;
  /** A live connection as Settings and its own page read it (#615, #620). */
  const listed = async (
    adapter: AuthContext['adapter'],
    row: McpConnection,
    consent: McpConsent,
  ) => ({
    id: row.id,
    clientId: row.clientId,
    name: await connectionName(adapter, row),
    lastUsedAt: row.lastUsedAt ?? null,
    access: consent.scopes.includes(MCP_DRAFT_SCOPE) ? 'Ledger + To review' : 'Ledger',
    scopes: consent.scopes,
    // The Groups the member left out (#617), for "N of M Groups" and the assistant's page.
    excludedGroupIds: row.excludedGroupIds ?? [],
  });
  /** The member's own connection with this id, while it is live; otherwise none. */
  const ownLive = async (adapter: AuthContext['adapter'], userId: string, id: string) => {
    const row = await adapter.findOne<McpConnection>({
      model: 'mcpConnection',
      where: [
        { field: 'id', value: id },
        { field: 'userId', value: userId },
      ],
    });
    const consent = row && (await liveMcpConsent(adapter, row, env));
    return row && consent ? { row, consent } : null;
  };
  const management = {
    id: 'splitbook-mcp-connections',
    init(ctx) {
      context = ctx;
    },
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path?.startsWith('/mcp/') === true ||
            ['/oauth2/consent', '/oauth2/continue'].includes(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            if (
              ctx.method === 'POST' &&
              ctx.headers?.get('origin') !== new URL(ctx.context.baseURL).origin
            )
              throw new APIError('FORBIDDEN', {
                message: 'Untrusted connection-management origin.',
              });
            const expected = ctx.headers?.get(EXPECTED_ACCOUNT_HEADER);
            if (expected && (await getSessionFromCtx(ctx))?.user.id !== expected)
              return Response.json(
                { error: 'ACCOUNT_CHANGED' },
                {
                  status: 419,
                  headers: { 'Cache-Control': 'no-store' },
                },
              );
          }),
        },
        {
          matcher: (ctx) =>
            ['/oauth2/delete-consent', '/oauth2/update-consent'].includes(ctx.path ?? ''),
          handler: createAuthMiddleware(async () => {
            // Generic consent CRUD does not rotate our authorization generation.
            throw new APIError('FORBIDDEN', {
              message: `Disconnect in ${PRODUCT_NAME} Settings, then reconnect to change permissions.`,
            });
          }),
        },
        {
          matcher: (ctx) => ctx.path === '/oauth2/consent',
          handler: createAuthMiddleware(async (ctx) => {
            // The Groups the member unticked (#617), held for this request until its consent is
            // granted, when consentReferenceId commits them with the grant.
            const body = ctx.body as
              | { accept?: unknown; oauth_query?: unknown; excluded_groups?: unknown }
              | undefined;
            if (body?.accept !== true || body.excluded_groups === undefined) return;
            const excluded = excludedGroupsSchema.safeParse(body.excluded_groups);
            if (!excluded.success)
              throw new APIError('BAD_REQUEST', { message: 'Unsupported Group selection.' });
            const session = await getSessionFromCtx(ctx);
            // Consent itself refuses a missing session or an invalid request.
            if (
              !session ||
              typeof body.oauth_query !== 'string' ||
              !(await verifyOAuthQueryParams(body.oauth_query, ctx.context.secret))
            )
              return;
            const clientId = new URLSearchParams(body.oauth_query).get('client_id');
            if (!clientId) return;
            await requireMcpMember(ctx.context.adapter, session.user.id, env);
            await holdExcludedGroups(
              ctx.context.adapter,
              {
                key: consentRequestKey(body.oauth_query, session.user.id),
                userId: session.user.id,
                clientId,
              },
              excluded.data,
            );
          }),
        },
      ],
    },
    schema: {
      // The Groups left out on an approval page, held until that request's consent is granted
      // (#617). Keyed by the authorization request, so they apply to its grant and no other.
      mcpPendingExclusion: {
        fields: {
          key: { type: 'string', required: true, unique: true },
          userId: {
            type: 'string',
            required: true,
            references: { model: 'user', field: 'id', onDelete: 'cascade' },
          },
          clientId: { type: 'string', required: true },
          excludedGroupIds: { type: 'string[]', required: true },
          createdAt: { type: 'date', required: true },
        },
      },
      mcpConnection: {
        fields: {
          key: { type: 'string', required: true, unique: true },
          userId: {
            type: 'string',
            required: true,
            references: { model: 'user', field: 'id', onDelete: 'cascade' },
          },
          clientId: { type: 'string', required: true },
          // The Groups the member left out of this assistant's reach (#617).
          excludedGroupIds: { type: 'string[]', required: false },
          generation: { type: 'string', required: true },
          createdAt: { type: 'date', required: true },
          name: { type: 'string', required: false },
          lastUsedAt: { type: 'date', required: false },
        },
      },
    },
    endpoints: {
      mcpConnections: createAuthEndpoint(
        '/mcp/connections',
        {
          method: 'GET',
          use: [sessionMiddleware],
          query: z.object({ offset: z.coerce.number().int().nonnegative().default(0) }),
        },
        async (ctx) => {
          await requireMcpMember(ctx.context.adapter, ctx.context.session.user.id, env);
          const rows = await ctx.context.adapter.findMany<McpConnection>({
            model: 'mcpConnection',
            where: [{ field: 'userId', value: ctx.context.session.user.id }],
            limit: 25,
            offset: ctx.query.offset,
            sortBy: { field: 'createdAt', direction: 'asc' },
          });
          const connections = [];
          for (const row of rows) {
            const consent = await liveMcpConsent(ctx.context.adapter, row, env);
            if (consent) connections.push(await listed(ctx.context.adapter, row, consent));
          }
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json({
            resource,
            connections,
            nextOffset: rows.length === 25 ? ctx.query.offset + 25 : null,
          });
        },
      ),
      mcpConnection: createAuthEndpoint(
        '/mcp/connection',
        {
          method: 'GET',
          use: [sessionMiddleware],
          query: z.object({ id: z.string().min(1).max(128) }),
        },
        async (ctx) => {
          await requireMcpMember(ctx.context.adapter, ctx.context.session.user.id, env);
          const live = await ownLive(
            ctx.context.adapter,
            ctx.context.session.user.id,
            ctx.query.id,
          );
          if (!live) throw new APIError('NOT_FOUND');
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json(await listed(ctx.context.adapter, live.row, live.consent));
        },
      ),
      // An assistant's page (#620): the Groups it leaves out, applied from its next call with no
      // new consent. Only the member's own live connection changes.
      setMcpConnectionGroups: createAuthEndpoint(
        '/mcp/connection-groups',
        {
          method: 'POST',
          use: [sessionMiddleware],
          body: z.object({
            id: z.string().min(1).max(128),
            excludedGroupIds: excludedGroupsSchema,
          }),
        },
        async (ctx) => {
          await requireMcpMember(ctx.context.adapter, ctx.context.session.user.id, env);
          const live = await ownLive(ctx.context.adapter, ctx.context.session.user.id, ctx.body.id);
          // The generation holds the write to the connection that was read live.
          const saved =
            live &&
            (await ctx.context.adapter.update<McpConnection>({
              model: 'mcpConnection',
              where: [
                { field: 'id', value: live.row.id },
                { field: 'generation', value: live.row.generation },
              ],
              update: { excludedGroupIds: ctx.body.excludedGroupIds },
            }));
          if (!saved) throw new APIError('NOT_FOUND');
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json({ excludedGroupIds: ctx.body.excludedGroupIds });
        },
      ),
      revokeMcpConnection: createAuthEndpoint(
        '/mcp/revoke',
        {
          method: 'POST',
          use: [sessionMiddleware],
          body: z.object({ id: z.string().min(1).max(128) }),
        },
        async (ctx) => {
          const where = [
            { field: 'id', value: ctx.body.id },
            { field: 'userId', value: ctx.context.session.user.id },
          ];
          // One atomic update is the revocation boundary. Old codes and refresh tokens
          // retain the old referenceId; consent cleanup is not relied on for security.
          const revoked = await ctx.context.adapter.update<McpConnection>({
            model: 'mcpConnection',
            where,
            update: { generation: randomUUID(), lastUsedAt: null },
          });
          if (!revoked) throw new APIError('NOT_FOUND');
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json({ disconnected: true });
        },
      ),
      mcpConsentDetails: createAuthEndpoint(
        '/mcp/consent-details',
        {
          method: 'GET',
          use: [sessionMiddleware],
          query: z.object({ oauth_query: z.string().min(1).max(16000) }),
        },
        async (ctx) => {
          await requireMcpMember(ctx.context.adapter, ctx.context.session.user.id, env);
          if (!(await verifyOAuthQueryParams(ctx.query.oauth_query, ctx.context.secret)))
            throw new APIError('BAD_REQUEST', {
              message: 'This connection request is invalid or expired.',
            });
          const query = new URLSearchParams(ctx.query.oauth_query);
          const clientId = query.get('client_id');
          const scopes = (query.get('scope') ?? '').split(' ').filter(Boolean);
          if (
            !clientId ||
            !scopes.includes(MCP_LEDGER_SCOPE) ||
            scopes.some((scope) => !MCP_SCOPES.includes(scope))
          )
            throw new APIError('BAD_REQUEST', { message: 'Unsupported connection permissions.' });
          ctx.setHeader('Cache-Control', 'no-store');
          // The assistant by the name it publishes, never by its raw client identity (#614).
          return ctx.json({
            clientId,
            scopes,
            ...(await assistantForApproval(ctx.context.adapter, clientId)),
            // The choice in force, so approving the same assistant again keeps it (#617).
            excludedGroupIds: await liveExcludedGroups(
              ctx.context.adapter,
              ctx.context.session.user.id,
              clientId,
              env,
            ),
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
  return [
    management,
    jwt(),
    mcp({
      resource,
      loginPage: '/mcp/login',
      consentPage: '/mcp/consent',
      scopes: MCP_SCOPES,
      accessTokenExpiresIn: 300,
      refreshTokenExpiresIn: MCP_REFRESH_TOKEN_SECONDS,
      allowDynamicClientRegistration: env.MCP_ALLOW_DCR === 'true',
      allowUnauthenticatedClientRegistration: env.MCP_ALLOW_DCR === 'true',
      // No machine grants: connections always represent a member.
      grantTypes: ['authorization_code', 'refresh_token'],
      postLogin: {
        page: '/mcp/consent',
        shouldRedirect: async () => false,
        consentReferenceId: async ({ user }) => {
          await requireMcpMember(context.adapter, user.id, env);
          const state = await getOAuthProviderState();
          const query = new URLSearchParams(state?.query);
          const clientId = query.get('client_id');
          if (!clientId) throw new APIError('BAD_REQUEST');
          // Stored as the approval page names it (#615): a posing or missing name gives the host.
          const { name } = await assistantForApproval(context.adapter, clientId);
          const key = JSON.stringify([user.id, clientId]);
          const find = () =>
            context.adapter.findOne<McpConnection>({
              model: 'mcpConnection',
              where: [{ field: 'key', value: key }],
            });
          let row = await find();
          if (!row) {
            try {
              row = await context.adapter.create<McpConnection>({
                model: 'mcpConnection',
                data: {
                  key,
                  userId: user.id,
                  clientId,
                  generation: randomUUID(),
                  createdAt: new Date(),
                  name,
                  lastUsedAt: null,
                },
              });
            } catch (error) {
              row = await find();
              if (!row) throw error;
            }
          }
          const consent = await context.adapter.findOne<McpConsent>({
            model: 'oauthConsent',
            where: [
              { field: 'userId', value: user.id },
              { field: 'clientId', value: clientId },
              { field: 'referenceId', value: row.generation },
            ],
          });
          if (consent && isMcpConnectionExpired(row, consent, env)) {
            // Reconnection starts a fresh authorization. Never let old tokens adopt
            // it, or rotate over activity that landed after the expiry read. It starts from
            // every Group too: only this approval's choice is committed below (#617).
            const renewed = await context.adapter.update<McpConnection>({
              model: 'mcpConnection',
              where: [
                { field: 'id', value: row.id },
                { field: 'generation', value: row.generation },
                { field: 'lastUsedAt', value: row.lastUsedAt ?? null },
              ],
              update: { generation: randomUUID(), lastUsedAt: null, excludedGroupIds: [] },
            });
            row = renewed ?? (await find());
            if (!row) throw new APIError('FORBIDDEN');
          } else if (!consent && row.excludedGroupIds?.length) {
            // Disconnected: this authorization starts from every Group too (#617).
            row =
              (await context.adapter.update<McpConnection>({
                model: 'mcpConnection',
                where: [
                  { field: 'id', value: row.id },
                  { field: 'generation', value: row.generation },
                ],
                update: { excludedGroupIds: [] },
              })) ?? row;
          }
          if (row.name !== name)
            await context.adapter.update({
              model: 'mcpConnection',
              where: [
                { field: 'id', value: row.id },
                { field: 'generation', value: row.generation },
              ],
              update: { name },
            });
          // The member's choice of Groups commits with this grant, or the grant fails (#617).
          await commitExcludedGroups(context.adapter, row, state?.query);
          return row.generation;
        },
      },
      extensions: [
        {
          claims: {
            accessToken: async ({ ctx, user, client, referenceId, scopes }) => {
              if (
                !user ||
                !(await currentMcpGrant(
                  ctx.context.adapter,
                  env,
                  user.id,
                  client.clientId,
                  referenceId,
                  scopes,
                ))
              )
                throw new APIError('FORBIDDEN', {
                  message: 'Connection expired, revoked or account no longer eligible.',
                });
              return { splitbook_generation: referenceId };
            },
          },
        },
      ],
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
  ];
}
