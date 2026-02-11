import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import GroupDetailView from "@/components/groups/GroupDetailView";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;

  return <GroupDetailView groupId={id} userId={session.user.id!} />;
}

