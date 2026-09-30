import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupDraft } from './types';
import { calendarDateError, correctionSummary, type FormValidation } from './field-feedback';

export const groupFields = ['name', 'startDate', 'endDate'] as const;
export type GroupField = (typeof groupFields)[number];
export type GroupFieldErrors = Partial<Record<GroupField, string>>;
export type GroupValidation = FormValidation<GroupField>;
export const groupFieldLabels: Record<GroupField, string> = {
  name: 'Name',
  startDate: 'Start date',
  endDate: 'End date',
};

/**
 * Local corrections before a Group is created, attached to their fields. The server still
 * validates the same shared schema; this only explains what can be fixed without a request.
 */
export function validateGroupDraft(draft: GroupDraft, today: string): GroupFieldErrors {
  const theme = getGroupTheme(draft.category);
  const name = draft.name.trim();
  const errors: GroupFieldErrors = {};
  if (!name)
    errors.name = `Add a name for this ${theme.nouns.singular}, such as ${theme.namePlaceholder.replace(/^e\.g\.\s*/, '')}.`;
  else if (name.length > 100) errors.name = 'Keep the name to 100 characters or fewer.';
  if (theme.dates === 'bounded') {
    const start = draft.startDate.trim(),
      end = draft.endDate.trim();
    const startError = start ? calendarDateError(start, today) : undefined;
    const endError = end ? calendarDateError(end, today) : undefined;
    if (startError) errors.startDate = startError;
    if (endError) errors.endDate = endError;
    else if (!startError && start && end && end < start)
      errors.endDate = `Choose an end date on or after the start date, ${start}.`;
  }
  return errors;
}

export const groupCorrectionSummary = (errors: GroupFieldErrors) =>
  correctionSummary(groupFields, groupFieldLabels, errors, 'creating the Group');
