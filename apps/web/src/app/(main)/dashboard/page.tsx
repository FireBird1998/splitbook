import type { Metadata } from 'next';
import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import DashboardView from '@/components/dashboard/DashboardView';

export const metadata: Metadata = { title: 'Home' };

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');

  return <DashboardView userId={user.id} userName={user.name || 'User'} />;
}
