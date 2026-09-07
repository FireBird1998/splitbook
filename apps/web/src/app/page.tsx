import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { isDemoMode } from '@/lib/auth-mode';
import AuthProvider from '@/providers/AuthProvider';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  if (isDemoMode()) {
    return (
      <AuthProvider>
        <DemoPersonaPicker />
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <LandingPage />
    </AuthProvider>
  );
}
