import type { IPendingActivity } from './financial-write';

/** Explicit public projection also applies to lean reads. Private delivery state never belongs here. */
export const publicActivityProjection = '_id group type actor metadata createdAt __v';

/** One canonical immutable payload for publication and duplicate-event comparison. */
export function activityPayload(event: IPendingActivity) {
  return {
    group: event.group,
    type: event.type,
    actor: event.actor,
    metadata: event.metadata,
    createdAt: event.occurredAt,
    ...(event.notificationContext
      ? {
          notificationContext: {
            version: event.notificationContext.version,
            eventId: event.notificationContext.eventId,
            kind: event.notificationContext.kind,
            groupId: event.notificationContext.groupId,
            recordId: event.notificationContext.recordId,
            occurredAt: event.notificationContext.occurredAt,
            recipientIds: Array.from(event.notificationContext.recipientIds),
          },
        }
      : {}),
  };
}
