import AuthProvider from '@/providers/AuthProvider';

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
