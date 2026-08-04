import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { isDemoMode } from '@/lib/auth-mode';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  if (isDemoMode()) {
    return <DemoPersonaPicker />;
  }

  return <LandingPage />;
}
