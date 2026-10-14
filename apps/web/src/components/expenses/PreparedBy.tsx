import { assistantAttributionSchema } from '@splitbook/shared/draft-attribution';

/** Provenance is optional on old records and hidden with the To review flag. */
export default function PreparedBy({
  value,
  inline = false,
}: {
  value: unknown;
  inline?: boolean;
}) {
  if (process.env.NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED !== 'true') return null;
  const result = assistantAttributionSchema.safeParse(value);
  if (!result.success) return null;
  return (
    <span>
      {inline ? ' · prepared by ' : 'Prepared by '}
      {result.data.name}
    </span>
  );
}
