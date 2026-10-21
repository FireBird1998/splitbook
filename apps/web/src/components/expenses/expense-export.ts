import { exportPath } from '@splitbook/shared/api-paths';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import { exportFailureMessage, fileNameFromDisposition } from '@/components/export/export-form';
import { apiFetch } from '@/lib/utils/api-fetch';
import { saveFile } from '@/lib/utils/save-file';

/**
 * Download just these Expenses of one Group as a CSV with each member's share (#613), built
 * by the same export as Export's own CSV, and named for the Group and the day. Resolves with
 * the file's name; rejects with what to tell the member when nothing was downloaded.
 */
export async function exportSelectedExpenses(
  groupId: string,
  expenses: readonly ExpenseRead[],
  timeZone: string,
): Promise<string> {
  let response: Response;
  try {
    response = await apiFetch(
      exportPath({
        groupIds: [groupId],
        expenseIds: expenses.map(({ _id }) => _id),
        include: ['shares'],
        format: 'csv',
        timeZone,
      }),
    );
  } catch {
    throw new Error(exportFailureMessage(0, null));
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(exportFailureMessage(response.status, body));
  }
  const fileName =
    fileNameFromDisposition(response.headers.get('Content-Disposition')) ?? 'selected-expenses.csv';
  saveFile(await response.blob(), fileName);
  return fileName;
}
