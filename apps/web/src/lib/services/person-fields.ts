/**
 * What a member-facing reply sends of a person (#517): their name and photo, beside their id.
 * Every populate of a member, payer, sharer, recorder or Activity actor selects these. An email
 * address reaches a Group's admin only in that Group's own read, and each member their own
 * (`group-member-emails.ts`).
 */
export const PERSON_FIELDS = 'name image';
