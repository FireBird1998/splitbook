/**
 * What a Connected assistant can't do, in the words the approval page lists (#614) and Connect's
 * "What an assistant can do" section repeats (#619): kept in one place so they never drift apart.
 * Only limits the server enforces: Groups are left out since Excluded Groups (#617).
 */
export const ASSISTANT_CANNOT = [
  'Save Expenses or payments',
  'Change anything in a Group',
  'See Groups left out',
  'See anyone’s email',
] as const;
