import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import ExpectedAccountProvider from '@/components/layout/ExpectedAccountProvider';
import SessionGuard from '@/components/layout/SessionGuard';
import SettlementAttemptsOwner from '@/components/settlements/SettlementAttemptsOwner';
import { isDemoMode } from '@/lib/auth-mode';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <ExpectedAccountProvider accountId={user.id}>
      <SessionGuard accountId={user.id} />
      <SettlementAttemptsOwner accountId={user.id} />
      <AppShell
        user={{ id: user.id, name: user.name, email: user.email, image: user.image }}
        demoMode={isDemoMode()}
      >
        {children}
      </AppShell>
    </ExpectedAccountProvider>
  );
}
