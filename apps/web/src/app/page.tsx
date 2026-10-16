import type { Metadata } from 'next';
import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { isDemoMode } from '@/lib/auth-mode';
import { whatsLive } from '@/lib/landing/whats-live';

const title = 'Splitbook · Every shared cost, worked out to the paisa';
const description =
  'Trips, flats, couples and teams. Add what was paid, split it the way it happened, and Splitbook shows who owes whom, then settles it in the fewest payments.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: 'website' },
};

export default async function Home() {
  const user = await getAuthUser();

  if (user) {
    redirect('/dashboard');
  }

  if (isDemoMode()) {
    return <DemoPersonaPicker />;
  }

  return <LandingPage live={whatsLive()} />;
}
