import type { AssistantRule } from './assistant-rule';

export interface AssistantReachGroup {
  id: string;
  /** Missing on older Groups, which allow assistants. */
  assistantRule?: AssistantRule;
}

const NOT_ALLOWED: AssistantRule = 'not_allowed';

/**
 * Reach among a member's live Groups. The caller supplies only Groups the member belongs to
 * that are not being deleted, and checks whether the connection itself is live separately.
 */
export function assistantReachesGroup(
  group: AssistantReachGroup,
  excludedGroupIds: readonly string[] | null = [],
): boolean {
  return (
    group.assistantRule !== NOT_ALLOWED &&
    !(excludedGroupIds ?? []).includes(group.id.toLowerCase())
  );
}

/**
 * The same reach policy for a Mongo reader, including membership and pending deletion. Ids
 * remain in the caller's representation (strings for Mongoose, ObjectIds for the raw driver).
 * Callers may add a specific id or pagination bound to `_id`, preserving its exclusions.
 */
export function assistantGroupFilter<Id>(reader: {
  memberId: Id;
  excludedGroupIds?: readonly Id[];
}) {
  return {
    'members.user': reader.memberId,
    deletionRequestedAt: null,
    _id: { $nin: [...(reader.excludedGroupIds ?? [])] },
    assistantRule: { $ne: NOT_ALLOWED },
  };
}
