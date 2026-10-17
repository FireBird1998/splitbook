import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LandingSection, { landingCard } from './LandingSection';

const CLAIMS = [
  {
    icon: CalculateOutlinedIcon,
    title: 'Exact money',
    text: 'Amounts are stored as whole paise or cents, never rounded floats, and every split adds up to the Expense.',
  },
  {
    icon: HistoryOutlinedIcon,
    title: 'Every change in Activity',
    text: 'Edits, deletions and payments are logged, so the Group can always see what changed and who changed it.',
  },
  {
    icon: LockOutlinedIcon,
    title: 'Private by default',
    text: 'Only the people in a Group see it. You sign in with Google; there is no password to leak.',
  },
];

/** "Trust": exact money, every change in Activity, private by default (#446). */
export default function LandingTrust() {
  return (
    <LandingSection title="Why you can trust it" hiddenTitle>
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          p: 0,
          m: 0,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        {CLAIMS.map(({ icon: Icon, title, text }) => (
          <Box component="li" key={title} sx={landingCard}>
            <Stack spacing={1.25}>
              <Icon color="primary" aria-hidden />
              <Typography variant="h6" component="h3" sx={{ m: 0 }}>
                {title}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {text}
              </Typography>
            </Stack>
          </Box>
        ))}
      </Box>
    </LandingSection>
  );
}
