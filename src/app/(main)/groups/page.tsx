import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import GroupsListView from "@/components/groups/GroupsListView";

export default async function GroupsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <GroupsListView userId={session.user.id!} />;
}

