import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import LaptopOutlinedIcon from '@mui/icons-material/LaptopOutlined';
import PhoneAndroidOutlinedIcon from '@mui/icons-material/PhoneAndroidOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import type { WhatsLive } from '@/lib/landing/whats-live';
import LandingSection, { landingCard } from './LandingSection';
import SignInWithGoogleButton from './SignInWithGoogleButton';

type Icon = typeof SearchOutlinedIcon;

function ClientCard({
  icon: Heading,
  title,
  points,
  action,
}: {
  icon: Icon;
  title: string;
  points: { icon: Icon; text: string }[];
  action: ReactNode;
}) {
  return (
    <Box sx={{ ...landingCard, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Heading color="primary" aria-hidden />
        <Typography variant="h6" component="h3" sx={{ m: 0 }}>
          {title}
        </Typography>
      </Stack>
      <Stack component="ul" spacing={1.75} sx={{ listStyle: 'none', p: 0, m: 0, flexGrow: 1 }}>
        {points.map(({ icon: Point, text }) => (
          <Stack component="li" key={text} direction="row" spacing={1.5}>
            <Point fontSize="small" color="action" aria-hidden sx={{ mt: 0.25 }} />
            <Typography variant="body1" color="text.primary">
              {text}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <Box>{action}</Box>
    </Box>
  );
}

/**
 * "Android and web": what each client is best at, each card with its action (#446). The Android
 * card, and every mention of Android, shows only with a Google Play listing (`storeBadge` is its
 * badge then); without one the web card stands alone.
 */
export default function LandingApps({
  live,
  storeBadge,
}: {
  live: WhatsLive;
  storeBadge: ReactNode;
}) {
  const android = live.playStoreUrl !== null;
  const web = (
    <ClientCard
      icon={LaptopOutlinedIcon}
      title="Web"
      points={[
        { icon: SearchOutlinedIcon, text: 'Search every Expense across your Groups.' },
        {
          icon: InsertChartOutlinedIcon,
          text: 'Charts of spending by Month, with the current Month in focus.',
        },
        {
          icon: FileDownloadOutlinedIcon,
          text: 'Export to CSV, keep a backup, or print a statement.',
        },
      ]}
      action={<SignInWithGoogleButton />}
    />
  );
  return (
    <LandingSection
      id="app"
      elevated
      eyebrow={android ? 'Android and web' : 'Web'}
      title={
        android ? 'One account on your phone and your laptop.' : 'Your Groups on a bigger screen.'
      }
      intro={
        android ? 'Same Groups, same balances. Add on the bus, review at your desk.' : undefined
      }
    >
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: '1fr',
            md: android ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 560px)',
          },
        }}
      >
        {android && (
          <ClientCard
            icon={PhoneAndroidOutlinedIcon}
            title="Android"
            points={[
              { icon: BoltOutlinedIcon, text: 'Add an Expense in a few taps, wherever you paid.' },
              {
                icon: CloudOffOutlinedIcon,
                // Finish later is To review's, so it's said only where To review is live.
                text: live.toReview
                  ? 'No signal? Your saved copy of each Group stays readable, and Finish later keeps a half-done Expense in To review.'
                  : 'No signal? Your saved copy of each Group stays readable.',
              },
              {
                icon: AccountBalanceWalletOutlinedIcon,
                text: 'Home shows what you owe and are owed in every currency.',
              },
            ]}
            action={storeBadge}
          />
        )}
        {web}
      </Box>
    </LandingSection>
  );
}
