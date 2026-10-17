import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import type { WhatsLive } from '@/lib/landing/whats-live';
import type { LandingSectionLink } from './LandingPage';

interface Plan {
  name: string;
  price: string;
  /** What the price buys, after it: "a month · or ₹199 a year". */
  per?: ReactNode;
  note: string;
  features: string[];
  action: string;
  /** The plan the section recommends: drawn in the brand colour, with its badge. */
  badge?: string;
}

/** An amount of money inside a sentence, in the money style. */
function Amount({ children }: { children: string }) {
  return (
    <Box component="span" sx={{ typography: 'money', fontWeight: 600 }}>
      {children}
    </Box>
  );
}

/**
 * Free and Plus at the launch prices of the launch and pricing plan (#447). Plus's Group limit
 * isn't settled, so it says "more Groups", never "every" or "unlimited".
 */
const PLANS: Plan[] = [
  {
    name: 'Free',
    price: '₹0',
    note: 'For a trip or two.',
    features: [
      'Three Groups, made or joined',
      'Expenses, splits, Balances and settle up',
      'Android and web',
      'Light ads, never on save or settle-up screens',
    ],
    action: 'Start free',
  },
  {
    name: 'Plus',
    price: '₹29',
    per: (
      <>
        a month · or <Amount>₹199</Amount> a year
      </>
    ),
    note: 'For the flat, the office and every trip.',
    features: [
      'More Groups',
      'No ads',
      'Web dashboards, Group insights and exports',
      'One subscription on Android and web',
    ],
    action: 'Get Plus',
    badge: 'Best value yearly',
  },
];

/** The top bar's link to the pricing section: only while the section shows. */
export function pricingSections(live: WhatsLive): LandingSectionLink[] {
  return live.pricingVisible ? [{ href: '#pricing', label: 'Pricing' }] : [];
}

function PlanCard({ plan }: { plan: Plan }) {
  const featured = !!plan.badge;
  const title = `plan-${plan.name.toLowerCase()}`;
  return (
    <Card
      component="article"
      variant="outlined"
      aria-labelledby={title}
      sx={{
        p: 3.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 2.25,
        ...(featured && { borderWidth: 2, borderColor: 'primary.main' }),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography id={title} variant="h6" component="h3" color="text.primary">
          {plan.name}
        </Typography>
        {plan.badge && (
          <Typography
            variant="caption"
            sx={{
              px: 1.25,
              py: 0.5,
              // Its padding stays outside the row, so both plans' prices line up.
              my: -0.5,
              borderRadius: 999,
              bgcolor: 'tint.brand',
              color: 'primary.main',
              fontWeight: 600,
            }}
          >
            {plan.badge}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1 }}>
        <Typography
          variant="h4"
          component="p"
          color="text.primary"
          sx={{ typography: 'money', fontWeight: 600 }}
        >
          {plan.price}
        </Typography>
        {plan.per && (
          <Typography variant="body1" color="text.secondary">
            {plan.per}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {plan.note}
      </Typography>
      <Stack component="ul" spacing={1.25} sx={{ m: 0, p: 0, listStyle: 'none', flex: 1 }}>
        {plan.features.map((feature) => (
          <Box
            component="li"
            key={feature}
            sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.25 }}
          >
            <CheckIcon
              fontSize="small"
              aria-hidden
              sx={{ mt: 0.25, color: featured ? 'primary.main' : 'text.secondary' }}
            />
            <Typography variant="body1" color="text.secondary">
              {feature}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Button
        href="/login"
        variant={featured ? 'contained' : 'outlined'}
        sx={{ alignSelf: 'flex-start' }}
      >
        {plan.action}
      </Button>
    </Card>
  );
}

/**
 * The pricing section, which shows only when this deployment says pricing is visible
 * (`LANDING_PRICING_VISIBLE=true`, once billing exists). Without it, nothing about pricing renders.
 */
export default function LandingPricing({ live }: { live: WhatsLive }) {
  if (!live.pricingVisible) return null;
  return (
    <Box
      component="section"
      id="pricing"
      aria-labelledby="pricing-title"
      sx={{
        py: { xs: 7, md: 13 },
        bgcolor: 'surface.elevated',
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 } }}>
        <Stack spacing={5} alignItems="center">
          <Stack spacing={1.75} alignItems="center" sx={{ maxWidth: 640, textAlign: 'center' }}>
            <Typography variant="overline" component="p" color="primary">
              Pricing
            </Typography>
            <Typography
              id="pricing-title"
              variant="h4"
              component="h2"
              color="text.primary"
              sx={{ m: 0, fontWeight: 700, letterSpacing: '-0.02em', textWrap: 'balance' }}
            >
              Free for a few Groups. <Amount>₹29</Amount> a month for more.
            </Typography>
            <Typography variant="lead" component="p" color="text.secondary" sx={{ maxWidth: 520 }}>
              Launch prices. <Amount>₹199</Amount> a year works out to under <Amount>₹17</Amount> a
              month.
            </Typography>
          </Stack>
          <Box
            sx={{
              width: '100%',
              maxWidth: 860,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              gap: 2.5,
            }}
          >
            {PLANS.map((plan) => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
