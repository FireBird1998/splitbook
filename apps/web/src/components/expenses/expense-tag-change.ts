import { expenseTagChangePath } from '@splitbook/shared/api-paths';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import {
  expenseTagChangeReplySchema,
  type ExpenseTagChangeReply,
} from '@splitbook/shared/expense-tag-change';
import { GROUP_ARCHIVED_MESSAGE } from '@splitbook/shared/group-archive';
import { apiFetch } from '@/lib/utils/api-fetch';

/** A whole request refused, which changed nothing, in member words by its status and code. */
function refusal(status: number, code: unknown): string {
  if (status === 403) return 'You’re no longer a member of this Group.';
  if (code === 'GROUP_ARCHIVED') return GROUP_ARCHIVED_MESSAGE;
  if (code === 'INVALID_TAG') return 'That Tag isn’t active any more. Choose another.';
  return 'Splitbook couldn’t change these Expenses. Check the list, then try again.';
}

/**
 * Move these Expenses to one Tag in one request (#610), each with the revision the list shows,
 * so one someone else changed since is left as it is. It's sent once, when the member picks the
 * Tag, and never again by itself. A refusal of the whole request, which changed nothing, rejects
 * with what to tell the member; otherwise each Expense's outcome comes back.
 */
export async function changeExpenseTags(
  groupId: string,
  tagId: string,
  expenses: readonly ExpenseRead[],
): Promise<ExpenseTagChangeReply> {
  let response: Response;
  try {
    response = await apiFetch(expenseTagChangePath(groupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tagId,
        expenses: expenses.map((expense) => ({ id: expense._id, revision: expense.revision ?? 0 })),
      }),
    });
  } catch {
    // Some may have changed before the reply was lost. Trying again changes none twice.
    throw new Error('We didn’t hear back. Check the list, then try again.');
  }
  const body = (await response.json().catch(() => null)) as {
    code?: unknown;
    data?: unknown;
  } | null;
  if (!response.ok) throw new Error(refusal(response.status, body?.code));
  const reply = expenseTagChangeReplySchema.safeParse(body?.data);
  if (!reply.success) throw new Error('We didn’t hear back. Check the list, then try again.');
  return reply.data;
}
