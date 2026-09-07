import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DashboardView from '@/components/dashboard/DashboardView';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return <DashboardView userId={session.user.id!} userName={session.user.name || 'User'} />;
}
