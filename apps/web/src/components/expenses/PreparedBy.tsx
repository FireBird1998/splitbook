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
  // A host without hyphens can't wrap at its dots: it wraps anywhere, so its end, where the
  // domain is, stays readable inside the card, cell or line that shows it (#751).
  return (
    <span>
      {inline ? ' · prepared by ' : 'Prepared by '}
      <bdi style={{ overflowWrap: 'anywhere' }}>{result.data.name}</bdi>
    </span>
  );
}
