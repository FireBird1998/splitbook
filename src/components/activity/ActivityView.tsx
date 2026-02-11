"use client";

import useSWR from "swr";
import Button from "@mui/material/Button";
import { formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/currency";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ACTIVITY_ICONS: Record<string, string> = {
  expense_added: "🧾",
  expense_updated: "✏️",
  expense_deleted: "🗑️",
  settlement_recorded: "💰",
  member_joined: "👤",
  member_left: "👋",
  group_created: "🎉",
  group_updated: "⚙️",
};

function getActivityText(activity: Record<string, unknown>): string {
  const actor = activity.actor as { name: string };
  const meta = activity.metadata as Record<string, unknown>;
  const type = activity.type as string;

  switch (type) {
    case "expense_added":
      return `${actor.name} added "${meta.description}" — ${formatCurrency(meta.amount as number, meta.currency as string)}`;
    case "expense_updated":
      return `${actor.name} updated "${meta.description}"`;
    case "expense_deleted":
      return `${actor.name} deleted "${meta.description}"`;
    case "settlement_recorded":
      return `${actor.name} recorded a payment of ${formatCurrency(meta.amount as number, meta.currency as string)}`;
    case "member_joined":
      return `${actor.name} joined the group`;
    case "member_left":
      return `${actor.name} left the group`;
    case "group_created":
      return `${actor.name} created the group`;
    case "group_updated":
      return `${actor.name} updated the group`;
    default:
      return `${actor.name} performed an action`;
  }
}

interface ActivityViewProps {
  groupId: string;
}

export default function ActivityView({ groupId }: ActivityViewProps) {
  const { data, isLoading } = useSWR(
    `/api/groups/${groupId}/activity?page=1&limit=50`,
    fetcher,
    { refreshInterval: 10_000 }
  );

  const activities = data?.data?.activities || [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4 animate-pulse h-16" />
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="bg-white rounded-xl p-12 text-center">
        <span className="text-4xl mb-4 block">📝</span>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No activity yet</h3>
        <p className="text-gray-500">Actions in this group will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((activity: Record<string, unknown>) => {
        const type = activity.type as string;
        const icon = ACTIVITY_ICONS[type] || "📋";

        return (
          <div
            key={activity._id as string}
            className="bg-white rounded-xl px-4 py-3 border border-gray-100 flex items-start gap-3"
          >
            <span className="text-lg mt-0.5">{icon}</span>
            <div className="flex-1">
              <p className="text-sm text-gray-900">{getActivityText(activity)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {formatDateTime(activity.createdAt as string)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

