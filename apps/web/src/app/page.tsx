import type { Metadata } from 'next';
import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { isDemoMode } from '@/lib/auth-mode';
import { whatsLive } from '@/lib/landing/whats-live';
import { LANDING_HEADLINE, LANDING_PROMISE } from '@/components/landing/landing-copy';

const title = `Splitbook · ${LANDING_HEADLINE.replace(/\.$/, '')}`;
const description = LANDING_PROMISE;

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
