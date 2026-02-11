"use client";

import Link from "next/link";
import Avatar from "@mui/material/Avatar";
import AvatarGroup from "@mui/material/AvatarGroup";

const CATEGORY_ICONS: Record<string, string> = {
  trip: "✈️",
  home: "🏠",
  couple: "💑",
  work: "💼",
  other: "📋",
};

interface GroupCardProps {
  group: Record<string, unknown>;
  userId: string;
}

export default function GroupCard({ group, userId }: GroupCardProps) {
  const members = (group.members || []) as Array<{
    user: { _id: string; name: string; image?: string };
    role: string;
  }>;
  const category = group.category as string;
  const icon = CATEGORY_ICONS[category] || "📋";

  return (
    <Link
      href={`/groups/${group._id}`}
      className="block bg-white rounded-xl p-6 border border-gray-100 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">
              {group.name as string}
            </h3>
            <span className="text-xs text-gray-500 capitalize">{category}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 28, height: 28, fontSize: 12 } }}>
          {members.map((m) => (
            <Avatar
              key={m.user._id}
              src={m.user.image}
              alt={m.user.name}
              sx={{ width: 28, height: 28 }}
            >
              {m.user.name?.[0]}
            </Avatar>
          ))}
        </AvatarGroup>
        <span className="text-xs text-gray-500">
          {members.length} member{members.length !== 1 ? "s" : ""}
        </span>
      </div>
    </Link>
  );
}

