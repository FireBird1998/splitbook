import { z } from 'zod/v4';

/** Client metadata is untrusted display text, never an authority or instruction. */
export function cleanAssistantName(name: string): string {
  const cleaned = name
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
  return Array.from(cleaned).slice(0, 40).join('').trim() || 'Assistant';
}

export const draftAttributionSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('member') }),
    z.object({ kind: z.literal('assistant'), name: z.string() }),
  ])
  .default({ kind: 'member' });
export type DraftAttribution = z.infer<typeof draftAttributionSchema>;
