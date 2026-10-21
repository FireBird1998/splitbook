import { z } from 'zod/v4';

/**
 * Client metadata is untrusted display text, never an authority or instruction. Null when nothing
 * printable is left, so each caller chooses its own fallback.
 */
export function cleanPublishedAssistantName(name: string): string | null {
  const cleaned = name
    .replace(/\s+/gu, ' ')
    // Control and format characters, and the letters that draw as blanks (#614).
    .replace(/[\p{Cc}\p{Cf}\u115f\u1160\u3164\uffa0\u2800]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const characters = Array.from(cleaned);
  // A name cut at 40 characters says so (#614).
  const shown = characters.length > 40 ? `${characters.slice(0, 39).join('').trim()}…` : cleaned;
  return shown || null;
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
