/**
 * What a member is told when an archived Group refuses a change (#578): every write to it
 * answers 409 GROUP_ARCHIVED with these words, and each client says them as they are.
 */
export const GROUP_ARCHIVED_MESSAGE =
  'This Group was archived, so nothing more can be saved in it.';
