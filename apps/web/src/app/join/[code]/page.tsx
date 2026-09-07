import { isDemoMode } from '@/lib/auth-mode';
import JoinGroupClient from '@/components/join/JoinGroupClient';

export default async function JoinGroupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinGroupClient code={code} authMode={isDemoMode() ? 'demo' : 'google'} />;
}
