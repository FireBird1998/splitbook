import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { visuallyHidden } from '@/components/insights/a11y';
import MoneyText from '@/components/common/MoneyText';
import LandingFigure from '@/components/landing-figures/LandingFigure';
import { nettingStation } from '@/components/landing-figures/generated';
import { PRODUCT_NAME } from '@/lib/product';
import LandingSection from './LandingSection';

/**
 * Settle up (#449): the five debts the story's Expenses leave become three payments. Fig 3 shows
 * the netting; the heading's counts and the payments beneath it are the figure's own, from the
 * story model and Splitbook's simplify step.
 */
export default function LandingSettleUp() {
  return (
    <LandingSection
      id="settle"
      elevated
      eyebrow="Settle up"
      title={nettingStation.headline}
      intro={`${PRODUCT_NAME} nets every Expense into one balance each, then works out the fewest payments that clear them. When someone pays you back, record it and the whole Group sees it in Activity.`}
    >
      <LandingFigure figure={nettingStation} />
      <Box
        component="ul"
        aria-label="The payments"
        sx={{ m: 0, mt: 3, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 1.25 }}
      >
        {nettingStation.payments.map((payment) => (
          <Box
            component="li"
            key={`${payment.from}-${payment.to}`}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 1,
              borderRadius: 1,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
              {payment.from}
            </Typography>
            <ArrowForwardIcon aria-hidden fontSize="inherit" sx={{ color: 'text.secondary' }} />
            <Box component="span" sx={visuallyHidden}>
              pays
            </Box>
            <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
              {payment.to}
            </Typography>
            <MoneyText
              amount={toMajorAmount(payment.amountMinor, nettingStation.currency)}
              currency={nettingStation.currency}
              tone="neutral"
              color="text.primary"
              sx={{ fontWeight: 600 }}
            />
          </Box>
        ))}
      </Box>
    </LandingSection>
  );
}
