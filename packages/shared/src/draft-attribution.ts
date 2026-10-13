import { z } from 'zod/v4';

/** Client metadata is untrusted display text, never an authority or instruction. */
export function cleanAssistantName(name: string): string {
  const cleaned = name
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(cleaned).slice(0, 40).join('').trim() || 'Assistant';
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
