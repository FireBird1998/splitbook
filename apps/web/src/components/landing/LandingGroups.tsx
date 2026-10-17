import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { GROUP_THEME_LIST } from '@splitbook/shared/group-themes';
import type { GroupCategory } from '@splitbook/shared/types';
import MoneyText from '@/components/common/MoneyText';
import { groupThemeIcon } from '@/components/layout/group-theme-icons';
import TripStrip from '@/components/trip/TripStrip';
import { PRODUCT_NAME } from '@/lib/product';
import LandingSection, { landingCard } from './LandingSection';

/** Each Theme's line on the landing page, from the design canvas "Landing page" (#443). */
const TAGLINES: Record<GroupCategory, string> = {
  trip: 'A getaway with a crew: travel, stays and shared meals, from the first day to the last.',
  home: 'A long-running home ledger: rent, groceries and utilities.',
  couple: 'Shared spending for two: dinners, gifts and everyday costs.',
  work: 'Team and project expenses: travel, meals and supplies.',
  other: 'Any shared pool of money: Sunday football, a club, a gift fund.',
};

/** A fictional Trip's days, as its Expenses list groups them. */
const TRIP_DAYS = [
  { day: 'Day 1', date: 'Fri 16 Oct', expenses: 4, spent: 6420 },
  { day: 'Day 2', date: 'Sat 17 Oct', expenses: 3, spent: 2800 },
  { day: 'Day 3', date: 'Sun 18 Oct', expenses: 2, spent: 3150 },
];

/** A fictional Household's last three Months. */
const MONTHS = [
  { month: 'Aug', spent: 21860 },
  { month: 'Sep', spent: 23540 },
  { month: 'Oct', spent: 17920 },
];

function TripExtras() {
  return (
    <Stack spacing={2}>
      <TripStrip
        name="Goa Weekend"
        currency="INR"
        dateLabel="Fri 16 Oct – Sun 18 Oct"
        memberCount={4}
        balance={{ amount: 1250, currency: 'INR' }}
      />
      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {TRIP_DAYS.map((row) => (
          <Box
            component="li"
            key={row.day}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 2,
              py: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              <Box component="strong" sx={{ color: 'text.primary', fontWeight: 600 }}>
                {row.day}
              </Box>{' '}
              · {row.date} · {row.expenses} Expenses
            </Typography>
            <MoneyText amount={row.spent} currency="INR" tone="neutral" color="text.primary" />
          </Box>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary">
        A boarding-pass header, a setup checklist and a date range, with Expenses grouped by Trip
        day.
      </Typography>
    </Stack>
  );
}

function HouseholdExtras() {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Month-by-month totals and a running balance.
      </Typography>
      <Box
        component="dl"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
          gap: 1,
          m: 0,
        }}
      >
        {MONTHS.map((row) => (
          <Box
            key={row.month}
            sx={{
              bgcolor: 'surface.muted',
              borderRadius: 1,
              p: 1.25,
              minWidth: 0,
              // A row on a phone, so no amount wraps; a tile from 600 px up.
              display: 'flex',
              flexDirection: { xs: 'row', sm: 'column' },
              justifyContent: 'space-between',
              alignItems: { xs: 'baseline', sm: 'flex-start' },
              gap: 0.5,
            }}
          >
            <Typography component="dt" variant="caption" color="text.secondary">
              {row.month}
            </Typography>
            <Box component="dd" sx={{ m: 0 }}>
              <MoneyText
                amount={row.spent}
                currency="INR"
                tone="neutral"
                color="text.primary"
                sx={{ whiteSpace: 'nowrap' }}
              />
            </Box>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

/** "Every kind of Group": the five Themes, with the boarding-pass strip on the Trip card (#446). */
export default function LandingGroups() {
  return (
    <LandingSection
      id="groups"
      elevated
      eyebrow="One app, every Group"
      title="Not just trips. Every kind of shared money."
      intro={`Pick what the Group is for when you make it. ${PRODUCT_NAME} shapes its header, its dates and its starter Tags around it.`}
    >
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        {GROUP_THEME_LIST.map((theme) => {
          const Icon = groupThemeIcon(theme.id);
          return (
            <Box
              key={theme.id}
              data-group-theme={theme.id}
              sx={{ ...landingCard, gridRow: theme.id === 'trip' ? { md: 'span 2' } : undefined }}
            >
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <Icon fontSize="small" color="primary" aria-hidden />
                  <Typography variant="h6" component="h3" sx={{ m: 0 }}>
                    {theme.label}
                  </Typography>
                </Stack>
                <Typography variant="body1" color="text.primary">
                  {TAGLINES[theme.id]}
                </Typography>
                {theme.id === 'trip' ? (
                  <TripExtras />
                ) : theme.id === 'home' ? (
                  <HouseholdExtras />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    A clean shared ledger with a running balance.
                  </Typography>
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </LandingSection>
  );
}
