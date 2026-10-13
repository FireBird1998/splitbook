import { connectedAssistantName } from './assistant-name';
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
import { MCP_LEDGER_SCOPE, MCP_SCOPES, mcpResource } from './config';
import { currentMcpGrant, requireMcpMember, type McpConnection, type McpConsent } from './grants';

export function mcpAuthPlugins(env: AuthEnv) {
  const resource = mcpResource(env);
  if (!resource) return [];
  let context: AuthContext;
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
              message: 'Disconnect in SplitBook Settings, then reconnect to change permissions.',
            });
          }),
        },
      ],
    },
    schema: {
      mcpConnection: {
        fields: {
          key: { type: 'string', required: true, unique: true },
          userId: {
            type: 'string',
            required: true,
            references: { model: 'user', field: 'id', onDelete: 'cascade' },
          },
          clientId: { type: 'string', required: true },
          generation: { type: 'string', required: true },
          createdAt: { type: 'date', required: true },
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
            const consent = await ctx.context.adapter.findOne<McpConsent>({
              model: 'oauthConsent',
              where: [
                { field: 'userId', value: row.userId },
                { field: 'clientId', value: row.clientId },
                { field: 'referenceId', value: row.generation },
              ],
            });
            if (consent)
              connections.push({
                id: row.id,
                clientId: row.clientId,
                name: await connectedAssistantName(ctx.context.adapter, row.clientId),
                scopes: consent.scopes,
              });
          }
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json({
            resource,
            connections,
            nextOffset: rows.length === 25 ? ctx.query.offset + 25 : null,
          });
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
            update: { generation: randomUUID() },
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
          return ctx.json({ clientId, scopes });
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
                },
              });
            } catch (error) {
              row = await find();
              if (!row) throw error;
            }
          }
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
                  message: 'Connection revoked or account no longer eligible.',
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
