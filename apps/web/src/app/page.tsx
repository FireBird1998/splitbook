import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { isDemoMode } from '@/lib/auth-mode';

export default async function Home() {
  const user = await getAuthUser();

  if (user) {
    redirect('/dashboard');
  }

  if (isDemoMode()) {
    return <DemoPersonaPicker />;
  }

  return <LandingPage />;
}
