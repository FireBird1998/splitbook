/**
 * How a recorded event names a member, on its own so the modules that word events (Activity and
 * a payment's record) can share it without importing each other.
 */

/** A recorded name or description, trimmed, or null when it holds nothing. */
export const recordedText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * A member as an event names them: "You" when their id is the viewer's (#442), never matched by
 * name, since two members can share one; otherwise their recorded name, or null without one.
 */
export function memberLabel(id: unknown, name: unknown, viewerId?: string): string | null {
  return viewerId && id === viewerId ? 'You' : recordedText(name);
}
