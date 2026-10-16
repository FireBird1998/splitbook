import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { calendarDate } from '@splitbook/shared/validators/calendar-date';
import {
  draftObjectId,
  draftRequestKey,
  createExpenseDraftsSchema,
  expenseDraftValuesSchema,
  DRAFT_GROUP_LIMIT_MESSAGE,
  ACTIVE_DRAFTS_PER_MEMBER,
} from '@splitbook/shared/validators/expense-draft';
import { assistantLedgerService } from '@/lib/services/assistant-ledger.service';
import { expenseDraftService, type DraftActor } from '@/lib/services/expense-draft.service';
import { MCP_DRAFT_SCOPE } from './config';

/** Tools are request-scoped. Identity and authorization never come from tool arguments. */
export function registerSplitbookTools(
  server: McpServer,
  actor: DraftActor,
  scopes: string[],
  appUrl: string,
) {
  const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  async function run(work: () => Promise<unknown>) {
    try {
      await actor.authorize?.();
      const value = await work();
      return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
          : error instanceof Error &&
              [
                'FORBIDDEN',
                'DRAFT_NOT_FOUND',
                'STALE_REVISION',
                'REVISION_REQUIRED',
                'IDEMPOTENCY_CONFLICT',
              ].includes(error.message)
            ? error.message
            : error instanceof Error && error.message === 'DRAFT_GROUP_LIMIT'
              ? DRAFT_GROUP_LIMIT_MESSAGE
              : 'Request could not be completed. Fetch the current state before retrying; reuse the original creation key.';
      return { isError: true, content: [{ type: 'text' as const, text: message }] };
    }
  }
  server.registerTool(
    'list_groups',
    {
      description: 'List your current Groups. Pass next as after to continue.',
      inputSchema: z.object({ after: draftObjectId.optional() }).strict(),
      annotations: read,
    },
    (input) => run(() => assistantLedgerService.groups(actor.id, input.after)),
  );
  server.registerTool(
    'group_context',
    {
      description:
        'Read current member identities, active Tags, the Category choices and currency. The member you are helping is marked you: true, so "I" and "me" are that member. Ask the member to resolve ambiguous names; never guess missing expense facts.',
      inputSchema: z.object({ groupId: draftObjectId }).strict(),
      annotations: read,
    },
    (input) => run(() => assistantLedgerService.context(actor.id, input.groupId)),
  );
  server.registerTool(
    'group_balances',
    {
      description:
        'Read recorded ledger Balances and suggested payments separately for each currency. Does not generate recurring Expenses.',
      inputSchema: z.object({ groupId: draftObjectId }).strict(),
      annotations: read,
    },
    (input) => run(() => assistantLedgerService.balances(actor.id, input.groupId)),
  );
  server.registerTool(
    'group_spending',
    {
      description:
        'Read paginated Expenses and full-range spending totals. Dates are inclusive UTC calendar days. Ask for explicit dates; never combine currencies.',
      inputSchema: z
        .object({
          groupId: draftObjectId,
          from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((value) => calendarDate.safeParse(value).success),
          to: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((value) => calendarDate.safeParse(value).success),
          page: z.number().int().min(1).max(100000).default(1),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .strict()
        .refine((input) => input.from <= input.to, 'from must not be after to'),
      annotations: read,
    },
    (input) => run(() => assistantLedgerService.spending(actor.id, input)),
  );
  if (!scopes.includes(MCP_DRAFT_SCOPE) || process.env.PERSISTENT_DRAFTS_ENABLED !== 'true') return;
  const reviewDescription = `These are items in the member's To review in Splitbook, where only the member can save them as Expenses; never call them drafts. Limit: ${ACTIVE_DRAFTS_PER_MEMBER} per member per Group.`;
  const preparationGuidance =
    "For one payer, give who paid; they paid the whole amount. For several payers, give each amount. Choose a Category only when the member's words make it clear; otherwise omit it, and it's saved as Other. Set the Group Tag that clearly matches the member's words (for example a meal and Food); if none clearly fits, ask the member.";
  const link = (groupId: string) => new URL(`/groups/${groupId}/review`, appUrl).href;
  server.registerTool(
    'list_drafts',
    {
      description: `List unfinished items, including those prepared by the member. They never affect Balances. ${reviewDescription}`,
      inputSchema: z.object({ groupId: draftObjectId }).strict(),
      annotations: read,
    },
    (input) =>
      run(async () => ({
        drafts: await expenseDraftService.list(actor, input.groupId),
        reviewUrl: link(input.groupId),
      })),
  );
  server.registerTool(
    'create_drafts',
    {
      description: `Prepare 1–10 items. Omit unknown facts and ask the member; never invent payers, dates, participants or amounts. ${preparationGuidance} Persist the same requestKey for exact retries. ${reviewDescription}`,
      inputSchema: z
        .object({
          groupId: draftObjectId,
          requestKey: draftRequestKey,
          drafts: createExpenseDraftsSchema.shape.drafts,
        })
        .strict(),
      annotations: { ...read, readOnlyHint: false, idempotentHint: true },
    },
    (input) =>
      run(async () => ({
        drafts: await expenseDraftService.create(
          actor,
          input.groupId,
          { drafts: input.drafts },
          input.requestKey,
        ),
        summary: `Added ${input.drafts.length} to To review in Splitbook`,
        reviewUrl: link(input.groupId),
      })),
  );
  server.registerTool(
    'replace_draft',
    {
      description: `Replace an unfinished item using its current revision. Include all facts to keep; omitted fields are cleared. If stale, fetch again and ask before overwriting a correction. ${preparationGuidance} ${reviewDescription}`,
      inputSchema: z
        .object({
          groupId: draftObjectId,
          draftId: draftObjectId,
          revision: z.number().int().nonnegative(),
          values: expenseDraftValuesSchema,
        })
        .strict(),
      annotations: { ...read, readOnlyHint: false },
    },
    (input) =>
      run(() =>
        expenseDraftService.replace(
          actor,
          input.groupId,
          input.draftId,
          input.values,
          input.revision,
        ),
      ),
  );
  server.registerTool(
    'discard_draft',
    {
      description: `PERMANENTLY delete one unfinished item at the reviewed revision. Content cannot be recovered. Never deletes a saved Expense. Use only when the member requests removal. ${reviewDescription}`,
      inputSchema: z
        .object({
          groupId: draftObjectId,
          draftId: draftObjectId,
          revision: z.number().int().nonnegative(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      run(() => expenseDraftService.discard(actor, input.groupId, input.draftId, input.revision)),
  );
}
