import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  return <LandingPage />;
}
