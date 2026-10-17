import type { Metadata } from 'next';
import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { isDemoMode } from '@/lib/auth-mode';
import { whatsLive } from '@/lib/landing/whats-live';
import { LANDING_HEADLINE, LANDING_PROMISE } from '@/components/landing/landing-copy';
import { splittingLine } from '@/components/landing-figures/generated';

const title = `Splitbook · ${LANDING_HEADLINE.replace(/\.$/, '')}`;
const description = LANDING_PROMISE;
const still = splittingLine.still;

/** The app's public address, which makes the link preview's image address absolute. */
function appUrl(): URL | undefined {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? '');
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: appUrl(),
  title,
  description,
  // The link preview is the light still of Fig 1 (#448).
  openGraph: {
    title,
    description,
    type: 'website',
    images: [{ url: still.src, width: still.width, height: still.height, alt: still.alt }],
  },
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
