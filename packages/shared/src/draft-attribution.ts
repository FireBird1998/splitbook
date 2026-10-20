import { z } from 'zod/v4';

/**
 * Client metadata is untrusted display text, never an authority or instruction. Null when nothing
 * printable is left, so each caller chooses its own fallback.
 */
export function cleanPublishedAssistantName(name: string): string | null {
  const cleaned = name
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(cleaned).slice(0, 40).join('').trim() || null;
}

/** An assistant's name as Draft attribution and Settings show it: cleaned, else Assistant. */
export function cleanAssistantName(name: string): string {
  return cleanPublishedAssistantName(name) ?? 'Assistant';
}

export const assistantAttributionSchema = z.object({
  kind: z.literal('assistant'),
  name: z.string(),
});
export type AssistantAttribution = z.infer<typeof assistantAttributionSchema>;

export const draftAttributionSchema = z
  .discriminatedUnion('kind', [z.object({ kind: z.literal('member') }), assistantAttributionSchema])
  .default({ kind: 'member' });
export type DraftAttribution = z.infer<typeof draftAttributionSchema>;
