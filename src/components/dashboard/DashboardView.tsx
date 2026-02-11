"use client";

import useSWR from "swr";
import Link from "next/link";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import AddIcon from "@mui/icons-material/Add";
import GroupCard from "@/components/groups/GroupCard";
import InvitationCard from "@/components/dashboard/InvitationCard";
import { formatCurrency } from "@/lib/utils/currency";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DashboardViewProps {
  userId: string;
  userName: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardView({ userId, userName }: DashboardViewProps) {
  const { data: groupsData, isLoading: groupsLoading } = useSWR(
    "/api/groups",
    fetcher,
    { refreshInterval: 30_000 }
  );
  const { data: invitationsData, mutate: mutateInvitations } = useSWR(
    "/api/invitations",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const groups = groupsData?.data || [];
  const invitations = invitationsData?.data || [];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {getGreeting()}, {userName.split(" ")[0]}! 👋
        </h1>
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            📩 Pending Invitations
            <Chip label={invitations.length} size="small" color="primary" />
          </h2>
          <div className="space-y-3">
            {invitations.map((inv: Record<string, unknown>) => (
              <InvitationCard
                key={inv._id as string}
                invitation={inv}
                onAction={() => mutateInvitations()}
              />
            ))}
          </div>
        </section>
      )}

      {/* Groups */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Your Groups</h2>
          <Button
            component={Link}
            href="/groups/new"
            variant="contained"
            startIcon={<AddIcon />}
            size="small"
            sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" } }}
          >
            New Group
          </Button>
        </div>

        {groupsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl p-6 animate-pulse h-36"
              />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <span className="text-4xl mb-4 block">👥</span>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No groups yet
            </h3>
            <p className="text-gray-500 mb-4">
              Create your first group to start splitting expenses!
            </p>
            <Button
              component={Link}
              href="/groups/new"
              variant="contained"
              startIcon={<AddIcon />}
              sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" } }}
            >
              Create Group
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((group: Record<string, unknown>) => (
              <GroupCard key={group._id as string} group={group} userId={userId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

