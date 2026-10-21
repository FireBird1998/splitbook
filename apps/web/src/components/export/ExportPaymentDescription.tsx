import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { EXCHANGE_RATE_API_ATTRIBUTION } from '@splitbook/shared/cross-currency-settlement';

/** The same stored-payment wording in the preview and printed statement. */
export default function ExportPaymentDescription({
  description,
  currency,
  paidCurrency,
}: {
  description: string;
  currency: string;
  paidCurrency?: string;
}) {
  const attributed = description.endsWith(EXCHANGE_RATE_API_ATTRIBUTION.text);
  return (
    <>
      {attributed ? (
        <>
          {description.slice(0, -EXCHANGE_RATE_API_ATTRIBUTION.text.length)}
          <Link href={EXCHANGE_RATE_API_ATTRIBUTION.url}>{EXCHANGE_RATE_API_ATTRIBUTION.text}</Link>
        </>
      ) : (
        description
      )}
      <Typography component="div" variant="caption" color="text.secondary">
        {currency} cleared · {paidCurrency} paid
      </Typography>
    </>
  );
}
