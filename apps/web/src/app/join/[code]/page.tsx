import { groupService } from '@/lib/services/group.service';
import { isDemoMode } from '@/lib/auth-mode';
import JoinGroupClient from '@/components/join/JoinGroupClient';

export default async function JoinGroupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinGroupClient code={code} authMode={isDemoMode() ? 'demo' : 'google'} />;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const group = await groupService.findByInviteCode(code);
  return { title: group ? `Join ${group.name}` : 'Join a Group' };
}
