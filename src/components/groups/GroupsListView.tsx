"use client";

import useSWR from "swr";
import Link from "next/link";
import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import GroupCard from "./GroupCard";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface GroupsListViewProps {
  userId: string;
}

export default function GroupsListView({ userId }: GroupsListViewProps) {
  const { data, isLoading } = useSWR("/api/groups", fetcher, {
    refreshInterval: 30_000,
  });

  const groups = data?.data || [];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
        <Button
          component={Link}
          href="/groups/new"
          variant="contained"
          startIcon={<AddIcon />}
          sx={{ backgroundColor: "#6C63FF", "&:hover": { backgroundColor: "#5A52D5" } }}
        >
          New Group
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-6 animate-pulse h-36" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <span className="text-4xl mb-4 block">👥</span>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No groups yet</h3>
          <p className="text-gray-500 mb-4">Create your first group to start splitting expenses!</p>
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
    </div>
  );
}

